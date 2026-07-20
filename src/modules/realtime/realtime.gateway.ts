import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

// In-memory registries
export const captainsRegistry = new Map<string, WebSocket>();
export const ridersRegistry = new Map<string, Set<WebSocket>>();
export const adminRegistry = new Set<WebSocket>();

const ADMIN_ROLES = ['super_admin', 'ops', 'finance', 'support'];

@WebSocketGateway({ path: '/api/v1/ws' })
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private redisClient: Redis;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private dbService: DatabaseService,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379/0';
    this.redisClient = new Redis(redisUrl);
    this.redisClient.on('error', (err) => {
      this.logger.error('Redis client error', err);
    });
  }

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        client.close(4001, 'Missing JWT authorization token');
        return;
      }

      // Verify Token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      const userId = payload.user_id;
      const role = payload.role;

      // Routing logic based on URL path
      const pathname = url.pathname;

      if (pathname.includes('/ws/captain')) {
        if (role !== 'captain') {
          client.close(4003, 'Unauthorized role access');
          return;
        }

        // Verify Captain KYC
        const capQuery = 'SELECT kyc_status FROM captains WHERE id = $1';
        const capRes = await this.dbService.query(capQuery, [userId]);
        if (capRes.rows.length === 0 || capRes.rows[0].kyc_status !== 'approved') {
          client.close(4005, 'Captain KYC is pending approval or rejected');
          return;
        }

        // Store Socket
        client['userId'] = userId;
        client['role'] = 'captain';
        captainsRegistry.set(userId, client);
        this.logger.log(`Captain ${userId} connected to WebSocket`);

        client.send(JSON.stringify({ event: 'connected', message: 'Ready to receive pings' }));

      } else if (pathname.includes('/ws/rider/')) {
        if (role !== 'rider') {
          client.close(4003, 'Unauthorized role access');
          return;
        }

        // Extract ride ID from path e.g. /api/v1/ws/rider/:ride_id
        const pathParts = pathname.split('/');
        const rideId = pathParts[pathParts.length - 1];

        if (!rideId) {
          client.close(4002, 'Missing ride identifier in path');
          return;
        }

        client['userId'] = userId;
        client['role'] = 'rider';
        client['rideId'] = rideId;

        if (!ridersRegistry.has(rideId)) {
          ridersRegistry.set(rideId, new Set());
        }
        ridersRegistry.get(rideId)!.add(client);
        this.logger.log(`Rider ${userId} subscribed to updates for ride ${rideId}`);

        client.send(JSON.stringify({ event: 'subscribed', ride_id: rideId }));

      } else if (pathname.includes('/admin/ws/rides')) {
        if (!ADMIN_ROLES.includes(role)) {
          client.close(4003, 'Unauthorized admin role');
          return;
        }

        client['userId'] = userId;
        client['role'] = 'admin';
        adminRegistry.add(client);
        this.logger.log(`Admin ${userId} (${role}) connected to live rides monitor WebSocket`);

        client.send(JSON.stringify({ event: 'connected', channel: 'admin_rides_monitor' }));

      } else {
        client.close(4004, 'Invalid socket path');
      }

    } catch (err) {
      this.logger.error('WebSocket connection error', err);
      client.close(4000, 'Authentication failed');
    }
  }

  async handleDisconnect(client: WebSocket) {
    const userId = client['userId'];
    const role = client['role'];

    if (role === 'captain' && userId) {
      captainsRegistry.delete(userId);
      // Remove from live Redis GEO index
      await this.redisClient.zrem('captains:live', userId);
      this.logger.log(`Captain ${userId} disconnected. Removed from live registry.`);
    } else if (role === 'rider' && userId) {
      const rideId = client['rideId'];
      if (rideId && ridersRegistry.has(rideId)) {
        const room = ridersRegistry.get(rideId)!;
        room.delete(client);
        if (room.size === 0) {
          ridersRegistry.delete(rideId);
        }
        this.logger.log(`Rider ${userId} unsubscribed from ride ${rideId}`);
      }
    } else if (role === 'admin') {
      adminRegistry.delete(client);
      this.logger.log(`Admin ${userId} disconnected from live monitor`);
    }
  }

  @SubscribeMessage('location_ping')
  async handleLocationPing(client: WebSocket, data: any) {
    const userId = client['userId'];
    const role = client['role'];

    if (role !== 'captain' || !userId) {
      return;
    }

    try {
      const payload = typeof data === 'string' ? JSON.parse(data) : data;
      const { lat, lng } = payload;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        client.send(JSON.stringify({ error: 'Invalid location payload schema' }));
        return;
      }

      // Update Postgres Location
      const updateLocation = `
        UPDATE captains 
        SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
            updated_at = NOW()
        WHERE id = $1;
      `;
      await this.dbService.query(updateLocation, [userId, lng, lat]);

      // Update Redis live location
      await this.redisClient.geoadd('captains:live', lng, lat, userId);

      client.send(JSON.stringify({ event: 'ping_acknowledged', timestamp: Date.now() }));
    } catch (err) {
      this.logger.error(`Error processing location ping for captain ${userId}`, err);
    }
  }
}
