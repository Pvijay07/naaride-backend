import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { captainsRegistry, ridersRegistry, adminRegistry } from './realtime.gateway';

@Injectable()
export class BroadcasterService {
  private readonly logger = new Logger(BroadcasterService.name);

  broadcastToRide(rideId: string, payload: any): void {
    const message = JSON.stringify(payload);

    // 1. Broadcast to Rider Room
    const clients = ridersRegistry.get(rideId);
    if (clients && clients.size > 0) {
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
      this.logger.log(`Broadcasted message to ride ${rideId} room (${clients.size} clients)`);
    }

    // 2. Broadcast to Admin Live Ride Monitors
    if (adminRegistry.size > 0) {
      for (const admin of adminRegistry) {
        if (admin.readyState === WebSocket.OPEN) {
          admin.send(message);
        }
      }
      this.logger.log(`Forwarded status frame to ${adminRegistry.size} connected admin ride monitors`);
    }
  }

  sendToCaptain(captainId: string, payload: any): boolean {
    const client = captainsRegistry.get(captainId);
    if (!client || client.readyState !== WebSocket.OPEN) {
      // Fall back to FCM Push Notification stub
      this.logger.warn(`Captain ${captainId} not connected over WS. Triggering fallback FCM Push Notification.`);
      return false;
    }

    client.send(JSON.stringify(payload));
    this.logger.log(`Dispatched real-time message to captain ${captainId}`);
    return true;
  }
}
