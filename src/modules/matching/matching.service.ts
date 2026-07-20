import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { BroadcasterService } from '../realtime/broadcaster.service';
import Redis from 'ioredis';
import { connect, NatsConnection, StringCodec } from 'nats';

interface SearchCoords {
  lat: number;
  lng: number;
}

@Injectable()
export class MatchingService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private natsConn: NatsConnection | null = null;
  private readonly sc = StringCodec();
  private readonly logger = new Logger(MatchingService.name);
  private subscription: any = null;

  constructor(
    private configService: ConfigService,
    private dbService: DatabaseService,
    private broadcaster: BroadcasterService,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379/0';
    this.redisClient = new Redis(redisUrl);
    this.redisClient.on('error', (err) => {
      this.logger.error('Redis client error', err);
    });
  }

  async onModuleInit() {
    const natsUrl = this.configService.get<string>('NATS_URL') || 'nats://localhost:4222';
    try {
      this.natsConn = await connect({ servers: natsUrl });
      this.subscribeToRequests();
    } catch (err) {
      this.logger.warn('NATS connection unavailable in Matching. Standing by for manual triggers.');
    }
  }

  async onModuleDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  private async subscribeToRequests() {
    if (!this.natsConn) return;

    this.subscription = this.natsConn.subscribe('ride.requested');
    this.logger.log('Subscribed to ride.requested channel');

    (async () => {
      for await (const msg of this.subscription) {
        try {
          const data = JSON.parse(this.sc.decode(msg.data));
          this.logger.log(`Received NATS ride request event for ride: ${data.rideId}`);
          
          // Trigger asynchronous matching loop
          this.matchRideWithCaptains(
            data.rideId,
            data.vehicleType,
            data.pickup,
            data.drop,
            data.estimatedFare
          );
        } catch (err) {
          this.logger.error('Error handling NATS ride request msg', err);
        }
      }
    })();
  }

  // Core Matching Loop
  async matchRideWithCaptains(
    rideId: string,
    vehicleType: string,
    pickup: SearchCoords,
    drop: SearchCoords,
    estimatedFare: number
  ) {
    this.logger.log(`Starting matching loop for ride: ${rideId}`);

    // Phase 1: Search within 3km
    let candidates = await this.findAndRankCaptains(pickup, vehicleType, 3);

    if (candidates.length === 0) {
      this.logger.log(`No captains found within 3km. Widening search radius to 6km.`);
      // Phase 2: Widen to 6km
      candidates = await this.findAndRankCaptains(pickup, vehicleType, 6);
    }

    if (candidates.length === 0) {
      this.logger.warn(`No captains available for ride ${rideId} within 6km.`);
      await this.cancelRideNoCaptains(rideId);
      return;
    }

    this.logger.log(`Found ${candidates.length} candidate captains for ride ${rideId}`);

    // Sequential Dispatching
    for (const captain of candidates) {
      // Check if ride was already accepted by another captain (just in case) or cancelled by rider
      const currentStatus = await this.getRideStatus(rideId);
      if (currentStatus !== 'requested') {
        this.logger.log(`Ride ${rideId} is no longer in requested state (current: ${currentStatus}). Aborting matching.`);
        return;
      }

      this.logger.log(`Offering ride ${rideId} to captain ${captain.id} (Score: ${captain.score.toFixed(2)})`);

      // Dispatch WS offer to captain
      const offerFrame = {
        event: 'ride_offer',
        ride_id: rideId,
        pickup,
        drop,
        estimated_fare: estimatedFare,
      };
      
      const sent = this.broadcaster.sendToCaptain(captain.id, offerFrame);

      // Store matching attempt in Redis (ttl 15s)
      const offerKey = `ride_offer:${rideId}`;
      await this.redisClient.set(offerKey, captain.id, 'EX', 15);

      // Wait 15s or until acceptance
      const accepted = await this.waitForAcceptance(rideId, captain.id);

      if (accepted) {
        this.logger.log(`Ride ${rideId} successfully accepted by captain ${captain.id}`);
        // Mark captain as having active ride in Redis
        await this.redisClient.set(`active_ride:captain:${captain.id}`, rideId);
        return;
      }

      this.logger.log(`Captain ${captain.id} did not accept. Proceeding to next candidate.`);
      await this.redisClient.del(offerKey);
    }

    // Exhausted all candidates
    this.logger.warn(`All candidate captains rejected or timed out for ride ${rideId}.`);
    await this.cancelRideNoCaptains(rideId);
  }

  private async findAndRankCaptains(pickup: SearchCoords, vehicleType: string, radiusKm: number) {
    // 1. Redis GEOSEARCH for online captains
    // Syntax in ioredis: geosearch(key, 'FROMLONLAT', lng, lat, 'BYRADIUS', radius, unit, 'WITHDIST')
    let geoResults: any[] = [];
    try {
      geoResults = await this.redisClient.geosearch(
        'captains:live',
        'FROMLONLAT',
        pickup.lng,
        pickup.lat,
        'BYRADIUS',
        radiusKm,
        'km',
        'WITHDIST'
      ) as any[];
    } catch (err) {
      this.logger.error('Redis GEOSEARCH error, falling back to database', err);
      // Fallback: Postgres PostGIS ST_DWithin query
      const dbFallback = `
        SELECT id, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)/1000.0 as distance
        FROM captains
        WHERE kyc_status = 'approved' AND vehicle_type = $3
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4 * 1000);
      `;
      const res = await this.dbService.query(dbFallback, [pickup.lng, pickup.lat, vehicleType, radiusKm]);
      geoResults = res.rows.map(r => [r.id, r.distance.toString()]);
    }

    if (!geoResults || geoResults.length === 0) return [];

    const captainIds = geoResults.map(r => r[0]);
    const distancesMap = new Map<string, number>(geoResults.map(r => [r[0], parseFloat(r[1])]));

    // 2. Filter out captains currently on active rides
    const filteredCaptainIds: string[] = [];
    for (const id of captainIds) {
      const activeRide = await this.redisClient.get(`active_ride:captain:${id}`);
      if (!activeRide) {
        filteredCaptainIds.push(id);
      }
    }

    if (filteredCaptainIds.length === 0) return [];

    // 3. Fetch ratings and acceptance rates from Postgres
    const q = `
      SELECT id, rating, acceptance_rate 
      FROM captains 
      WHERE id = ANY($1) AND vehicle_type = $2 AND kyc_status = 'approved';
    `;
    const dbRes = await this.dbService.query(q, [filteredCaptainIds, vehicleType]);

    // 4. Calculate Scores
    const scored = dbRes.rows.map(c => {
      const distance = distancesMap.get(c.id) || radiusKm;
      const rating = parseFloat(c.rating || '5.0');
      const acceptanceRate = parseFloat(c.acceptance_rate || '100.0');

      // Score formula weights: 0.7 distance + 0.2 rating + 0.1 acceptance rate
      const distanceScore = 1 - (distance / radiusKm);
      const ratingScore = rating / 5.0;
      const acceptanceScore = acceptanceRate / 100.0;

      const score = (0.7 * distanceScore) + (0.2 * ratingScore) + (0.1 * acceptanceScore);

      return {
        id: c.id,
        score,
      };
    });

    // Sort descending by score
    return scored.sort((a, b) => b.score - a.score);
  }

  private async getRideStatus(rideId: string): Promise<string> {
    const q = 'SELECT status FROM rides WHERE id = $1';
    const res = await this.dbService.query(q, [rideId]);
    return res.rows.length > 0 ? res.rows[0].status : 'unknown';
  }

  private async waitForAcceptance(rideId: string, captainId: string): Promise<boolean> {
    // Poll the ride status in database every 1 second, for up to 15 seconds
    for (let i = 0; i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const status = await this.getRideStatus(rideId);
      if (status === 'accepted') {
        return true;
      }
      
      // If ride is cancelled in the meantime, stop waiting
      if (status === 'cancelled') {
        return false;
      }

      // Check if captain explicitly rejected the ride
      const rejected = await this.redisClient.get(`ride_reject:${rideId}:${captainId}`);
      if (rejected) {
        return false;
      }
    }
    return false;
  }

  private async cancelRideNoCaptains(rideId: string) {
    await this.dbService.transaction(async (client) => {
      const updateRide = `
        UPDATE rides 
        SET status = 'cancelled', updated_at = NOW() 
        WHERE id = $1;
      `;
      await client.query(updateRide, [rideId]);

      const insertHistory = `
        INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
        VALUES ($1, 'cancelled', 'system', 'No captains nearby accepted the request');
      `;
      await client.query(insertHistory, [rideId]);
    });

    // Broadcast cancellation update to rider room
    this.broadcaster.broadcastToRide(rideId, {
      event: 'ride_status_update',
      ride_id: rideId,
      status: 'cancelled',
      reason: 'No captains available in your area',
    });
  }
}
