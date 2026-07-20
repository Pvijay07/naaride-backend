import { Injectable, NotFoundException, BadRequestException, UnauthorizedException, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { BroadcasterService } from '../realtime/broadcaster.service';
import { PaymentsService } from '../payments/payments.service';
import Redis from 'ioredis';
import { connect, NatsConnection, StringCodec } from 'nats';

interface Location {
  lat: number;
  lng: number;
}

@Injectable()
export class RidesService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private natsConn: NatsConnection | null = null;
  private readonly sc = StringCodec();
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private configService: ConfigService,
    private dbService: DatabaseService,
    private broadcaster: BroadcasterService,
    private paymentsService: PaymentsService,
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
      this.logger.log('Connected to NATS message broker successfully');
    } catch (err) {
      this.logger.warn('Failed to connect to NATS. NATS event publishing will be stubbed.', err);
    }
  }

  async onModuleDestroy() {
    if (this.natsConn) {
      await this.natsConn.close();
      this.logger.log('NATS connection closed');
    }
  }

  async estimateFare(city: string, vehicleType: 'bike' | 'auto' | 'cab', pickup: Location, drop: Location) {
    // Look up pricing rules
    const pricingQuery = 'SELECT * FROM pricing_rules WHERE city = $1 AND vehicle_type = $2';
    const pricingRes = await this.dbService.query(pricingQuery, [city, vehicleType]);

    let rules = {
      base_fare: 40.00,
      per_km_rate: 15.00,
      per_min_rate: 2.00,
      min_fare: 50.00,
      cancellation_fee: 20.00,
    };

    if (pricingRes.rows.length > 0) {
      const row = pricingRes.rows[0];
      rules = {
        base_fare: parseFloat(row.base_fare),
        per_km_rate: parseFloat(row.per_km_rate),
        per_min_rate: parseFloat(row.per_min_rate),
        min_fare: parseFloat(row.min_fare),
        cancellation_fee: parseFloat(row.cancellation_fee),
      };
    }

    // Google Maps Distance Matrix simulation / stub
    // Straight line distance estimate * 1.3 as road route factor
    const rad = Math.PI / 180;
    const R = 6371; // Earth radius in km
    const dLat = (drop.lat - pickup.lat) * rad;
    const dLng = (drop.lng - pickup.lng) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(pickup.lat * rad) * Math.cos(drop.lat * rad) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightDistance = R * c;
    const distanceKm = Math.max(0.5, parseFloat((straightDistance * 1.3).toFixed(2)));
    
    // Average speed 25 km/h for bike, 20 km/h for auto/cab in Indian traffic
    const speed = vehicleType === 'bike' ? 25 : 20;
    const durationMin = Math.max(2, Math.round((distanceKm / speed) * 60));

    // Fetch surge multiplier from Redis
    const surgeKey = `surge:${city}`;
    const surgeStr = await this.redisClient.get(surgeKey);
    const surgeMultiplier = surgeStr ? parseFloat(surgeStr) : 1.0;

    // Calculate fare
    const distanceFare = distanceKm * rules.per_km_rate;
    const durationFare = durationMin * rules.per_min_rate;
    let totalFare = (rules.base_fare + distanceFare + durationFare) * surgeMultiplier;
    
    if (totalFare < rules.min_fare) {
      totalFare = rules.min_fare;
    }

    totalFare = parseFloat(totalFare.toFixed(2));

    return {
      distance_km: distanceKm,
      duration_min: durationMin,
      base_fare: rules.base_fare,
      distance_fare: parseFloat(distanceFare.toFixed(2)),
      duration_fare: parseFloat(durationFare.toFixed(2)),
      surge_multiplier: surgeMultiplier,
      total_fare: totalFare,
      min_fare: rules.min_fare,
    };
  }

  async requestRide(
    riderId: string,
    vehicleType: 'bike' | 'auto' | 'cab',
    pickup: Location,
    drop: Location,
    estimatedFare: number,
    paymentMode: 'cash' | 'online',
  ) {
    // 1. Verify no active ride exists for the rider
    const activeCheckQuery = `
      SELECT id FROM rides 
      WHERE rider_id = $1 
        AND status IN ('requested', 'accepted', 'arrived', 'in_progress');
    `;
    const activeCheckRes = await this.dbService.query(activeCheckQuery, [riderId]);
    if (activeCheckRes.rows.length > 0) {
      throw new BadRequestException({
        success: false,
        error: { code: 'ACTIVE_RIDE_EXISTS', message: 'Rider already has an active ride session' },
      });
    }

    // 2. Insert new ride and log history
    const ride = await this.dbService.transaction(async (client) => {
      // PostGIS pickup & drop inserts
      const insertRide = `
        INSERT INTO rides (
          rider_id, status, vehicle_type, estimated_fare, payment_mode, payment_status,
          pickup_location, drop_location
        )
        VALUES (
          $1, 'requested', $2, $3, $4, 'pending',
          ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
          ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography
        )
        RETURNING id, status, vehicle_type, estimated_fare, payment_mode, created_at;
      `;
      const res = await client.query(insertRide, [
        riderId, vehicleType, estimatedFare, paymentMode, pickup.lng, pickup.lat, drop.lng, drop.lat
      ]);
      const newRide = res.rows[0];

      const insertHistory = `
        INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
        VALUES ($1, 'requested', 'rider', 'Ride requested by customer');
      `;
      await client.query(insertHistory, [newRide.id]);

      return newRide;
    });

    // Generate 4-digit OTP for starting the ride
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    await this.redisClient.set(`ride_otp:${ride.id}`, otp, 'EX', 7200); // 2 hours
    this.logger.log(`Generated OTP code ${otp} for ride ${ride.id}`);

    // 3. Publish request event to NATS
    const payload = JSON.stringify({
      rideId: ride.id,
      riderId,
      vehicleType,
      pickup,
      drop,
      estimatedFare,
      otp,
    });

    if (this.natsConn) {
      this.natsConn.publish('ride.requested', this.sc.encode(payload));
    }

    return { ...ride, otp };
  }

  async getRideDetails(rideId: string) {
    const rideQuery = `
      SELECT 
        r.id, r.rider_id, r.captain_id, r.status, r.estimated_fare, r.final_fare, 
        r.payment_mode, r.payment_status, r.created_at,
        ST_X(r.pickup_location::geometry) as pickup_lng, ST_Y(r.pickup_location::geometry) as pickup_lat,
        ST_X(r.drop_location::geometry) as drop_lng, ST_Y(r.drop_location::geometry) as drop_lat,
        u.name as rider_name, u.phone as rider_phone,
        c.name as captain_name, c.phone as captain_phone, c.vehicle_type
      FROM rides r
      JOIN users u ON r.rider_id = u.id
      LEFT JOIN captains c ON r.captain_id = c.id
      WHERE r.id = $1;
    `;
    const res = await this.dbService.query(rideQuery, [rideId]);
    if (res.rows.length === 0) {
      throw new NotFoundException({
        success: false,
        error: { code: 'RIDE_NOT_FOUND', message: 'Requested ride session not found' },
      });
    }

    const historyQuery = `
      SELECT status, changed_by, reason, created_at 
      FROM ride_status_history 
      WHERE ride_id = $1 
      ORDER BY created_at ASC;
    `;
    const historyRes = await this.dbService.query(historyQuery, [rideId]);

    return {
      ...res.rows[0],
      history: historyRes.rows,
    };
  }

  async cancelRide(rideId: string, cancellerId: string, role: 'rider' | 'captain') {
    const rideDetails = await this.getRideDetails(rideId);

    // Validate ownership
    if (role === 'rider' && rideDetails.rider_id !== cancellerId) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'UNAUTHORIZED_CANCEL', message: 'You are not the requester of this ride' },
      });
    }
    if (role === 'captain' && rideDetails.captain_id !== cancellerId) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'UNAUTHORIZED_CANCEL', message: 'You are not the assigned captain of this ride' },
      });
    }

    // Validate allowed state transitions
    const allowedStates = ['requested', 'accepted', 'arrived'];
    if (!allowedStates.includes(rideDetails.status)) {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Cannot cancel a ride that is already in progress or completed' },
      });
    }

    // Determine cancellation fee: if status is accepted/arrived and elapsed time > 2 mins
    let fee = 0.00;
    const acceptedEvent = rideDetails.history.find(h => h.status === 'accepted');
    
    if (acceptedEvent && (rideDetails.status === 'accepted' || rideDetails.status === 'arrived')) {
      const acceptedTime = new Date(acceptedEvent.created_at).getTime();
      const elapsedMinutes = (Date.now() - acceptedTime) / 60000;
      if (elapsedMinutes > 2) {
        // Fetch pricing rules cancellation fee
        const rulesQuery = 'SELECT cancellation_fee FROM pricing_rules WHERE vehicle_type = $1 LIMIT 1';
        const rulesRes = await this.dbService.query(rulesQuery, [rideDetails.vehicle_type]);
        fee = rulesRes.rows.length > 0 ? parseFloat(rulesRes.rows[0].cancellation_fee) : 20.00;
      }
    }

    await this.dbService.transaction(async (client) => {
      const updateRide = `
        UPDATE rides 
        SET status = 'cancelled', final_fare = $2, updated_at = NOW() 
        WHERE id = $1;
      `;
      await client.query(updateRide, [rideId, fee]);

      const insertHistory = `
        INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
        VALUES ($1, 'cancelled', $2, $3);
      `;
      await client.query(insertHistory, [
        rideId, role, `Ride cancelled by ${role}. Cancellation fee of INR ${fee} applied.`
      ]);
    });

    if (this.natsConn) {
      this.natsConn.publish('ride.cancelled', this.sc.encode(JSON.stringify({ rideId, cancelledBy: role })));
    }

    return { ride_id: rideId, status: 'cancelled', cancellation_fee: fee };
  }

  async rateRide(rideId: string, userId: string, score: number, comment?: string) {
    // Verify ride exists and is completed
    const ride = await this.getRideDetails(rideId);
    if (ride.status !== 'completed') {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVALID_RIDE_STATE', message: 'Only completed rides can be rated' },
      });
    }

    const role = ride.rider_id === userId ? 'rider' : 'captain';

    // Insert rating
    const ratingQuery = `
      INSERT INTO ratings (ride_id, rater_role, score, comment)
      VALUES ($1, $2, $3, $4)
      RETURNING id, score, comment;
    `;
    const ratingRes = await this.dbService.query(ratingQuery, [rideId, role, score, comment]);

    // Update average rating for captain
    if (role === 'rider' && ride.captain_id) {
      const avgQuery = `
        SELECT AVG(score)::numeric(3,2) as avg_rating 
        FROM ratings r
        JOIN rides rd ON r.ride_id = rd.id
        WHERE rd.captain_id = $1 AND r.rater_role = 'rider';
      `;
      const avgRes = await this.dbService.query(avgQuery, [ride.captain_id]);
      const newAvg = avgRes.rows[0].avg_rating;

      const updateCaptainQuery = 'UPDATE captains SET rating = $2 WHERE id = $1';
      await this.dbService.query(updateCaptainQuery, [ride.captain_id, newAvg]);
    }

    return ratingRes.rows[0];
  }

  async getHistory(userId: string, role: 'rider' | 'captain') {
    const q = role === 'rider'
      ? `SELECT id, status, estimated_fare, final_fare, payment_mode, payment_status, created_at FROM rides WHERE rider_id = $1 ORDER BY created_at DESC`
      : `SELECT id, status, estimated_fare, final_fare, payment_mode, payment_status, created_at FROM rides WHERE captain_id = $1 ORDER BY created_at DESC`;
    const res = await this.dbService.query(q, [userId]);
    return res.rows;
  }

  async acceptRide(rideId: string, captainId: string) {
    const ride = await this.dbService.transaction(async (client) => {
      // 1. SELECT FOR UPDATE to lock the ride row and prevent double-accept
      const lockQuery = 'SELECT status, captain_id FROM rides WHERE id = $1 FOR UPDATE';
      const lockRes = await client.query(lockQuery, [rideId]);
      
      if (lockRes.rows.length === 0) {
        throw new NotFoundException({
          success: false,
          error: { code: 'RIDE_NOT_FOUND', message: 'Ride session not found' },
        });
      }

      const row = lockRes.rows[0];
      if (row.status !== 'requested' || row.captain_id !== null) {
        throw new BadRequestException({
          success: false,
          error: { code: 'RIDE_ALREADY_TAKEN', message: 'Ride has already been accepted or cancelled' },
        });
      }

      // 2. Update ride status and assign captain
      const updateQuery = `
        UPDATE rides 
        SET status = 'accepted', captain_id = $2, updated_at = NOW() 
        WHERE id = $1
        RETURNING id, status, estimated_fare, payment_mode;
      `;
      const updateRes = await client.query(updateQuery, [rideId, captainId]);
      
      const insertHistory = `
        INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
        VALUES ($1, 'accepted', 'captain', 'Ride accepted by captain');
      `;
      await client.query(insertHistory, [rideId]);

      return updateRes.rows[0];
    });

    // Broadcast update to rider
    this.broadcaster.broadcastToRide(rideId, {
      event: 'ride_status_update',
      ride_id: rideId,
      status: 'accepted',
      captain_id: captainId,
    });

    return ride;
  }

  async arriveAtPickup(rideId: string, captainId: string) {
    const ride = await this.getRideDetails(rideId);
    if (ride.captain_id !== captainId || ride.status !== 'accepted') {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Ride is not in accepted state or not assigned to you' },
      });
    }

    await this.dbService.transaction(async (client) => {
      const updateQuery = `
        UPDATE rides 
        SET status = 'arrived', updated_at = NOW() 
        WHERE id = $1;
      `;
      await client.query(updateQuery, [rideId]);

      const insertHistory = `
        INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
        VALUES ($1, 'arrived', 'captain', 'Captain arrived at pickup point');
      `;
      await client.query(insertHistory, [rideId]);
    });

    this.broadcaster.broadcastToRide(rideId, {
      event: 'ride_status_update',
      ride_id: rideId,
      status: 'arrived',
    });

    return { ride_id: rideId, status: 'arrived' };
  }

  async startRide(rideId: string, captainId: string, otp: string) {
    const ride = await this.getRideDetails(rideId);
    if (ride.captain_id !== captainId || ride.status !== 'arrived') {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Ride is not in arrived state' },
      });
    }

    // Verify OTP from Redis
    const storedOtp = await this.redisClient.get(`ride_otp:${rideId}`);
    if (!storedOtp || storedOtp !== otp) {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVALID_OTP', message: 'Invalid start OTP code provided' },
      });
    }

    await this.dbService.transaction(async (client) => {
      const updateQuery = `
        UPDATE rides 
        SET status = 'in_progress', updated_at = NOW() 
        WHERE id = $1;
      `;
      await client.query(updateQuery, [rideId]);

      const insertHistory = `
        INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
        VALUES ($1, 'in_progress', 'captain', 'Trip started (OTP verified)');
      `;
      await client.query(insertHistory, [rideId]);
    });

    this.broadcaster.broadcastToRide(rideId, {
      event: 'ride_status_update',
      ride_id: rideId,
      status: 'in_progress',
    });

    return { ride_id: rideId, status: 'in_progress' };
  }

  async completeRide(rideId: string, captainId: string) {
    const ride = await this.getRideDetails(rideId);
    if (ride.captain_id !== captainId || ride.status !== 'in_progress') {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Ride is not in progress' },
      });
    }

    const finalFare = parseFloat(ride.estimated_fare);
    // Deduct 15% commission, credit 85% to captain's wallet
    const netEarnings = finalFare * 0.85;

    await this.dbService.transaction(async (client) => {
      const payStatus = ride.payment_mode === 'cash' ? 'captured' : 'pending';

      const updateQuery = `
        UPDATE rides 
        SET status = 'completed', final_fare = $2, payment_status = $3, updated_at = NOW() 
        WHERE id = $1;
      `;
      await client.query(updateQuery, [rideId, finalFare, payStatus]);

      const insertHistory = `
        INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
        VALUES ($1, 'completed', 'captain', 'Ride completed by captain');
      `;
      await client.query(insertHistory, [rideId]);

      // Credit wallet transaction ledger row
      const insertWalletTx = `
        INSERT INTO wallet_transactions (captain_id, amount, type, description)
        VALUES ($1, $2, 'ride_fare', $3);
      `;
      await client.query(insertWalletTx, [
        captainId,
        netEarnings,
        `Earning for completed ride ${rideId} (commission of 15% deducted)`
      ]);
    });

    // Clear active keys in Redis
    await this.redisClient.del(`active_ride:captain:${captainId}`);
    await this.redisClient.del(`ride_otp:${rideId}`);

    let razorpayOrderId = null;
    if (ride.payment_mode === 'online') {
      try {
        razorpayOrderId = await this.paymentsService.createRazorpayOrder(rideId, finalFare);
      } catch (err) {
        this.logger.error(`Failed to register Razorpay order for completed ride ${rideId}`, err);
      }
    }

    this.broadcaster.broadcastToRide(rideId, {
      event: 'ride_status_update',
      ride_id: rideId,
      status: 'completed',
      final_fare: finalFare,
      razorpay_order_id: razorpayOrderId,
    });

    return { ride_id: rideId, status: 'completed', final_fare: finalFare, razorpay_order_id: razorpayOrderId };
  }
}
