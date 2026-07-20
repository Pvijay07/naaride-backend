-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByPhone :one
SELECT * FROM users WHERE phone = $1;

-- name: UpsertUser :one
INSERT INTO users (phone, name, email, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (phone) DO UPDATE 
SET name = COALESCE(users.name, EXCLUDED.name),
    email = COALESCE(users.email, EXCLUDED.email),
    updated_at = NOW()
RETURNING *;

-- name: GetCaptainByID :one
SELECT * FROM captains WHERE id = $1;

-- name: GetCaptainByPhone :one
SELECT * FROM captains WHERE phone = $1;

-- name: UpsertCaptain :one
INSERT INTO captains (phone, name, vehicle_type, kyc_status, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (phone) DO UPDATE 
SET name = COALESCE(captains.name, EXCLUDED.name),
    vehicle_type = EXCLUDED.vehicle_type,
    kyc_status = COALESCE(captains.kyc_status, EXCLUDED.kyc_status),
    updated_at = NOW()
RETURNING *;

-- name: UpdateCaptainLocation :exec
UPDATE captains 
SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
    updated_at = NOW()
WHERE id = $1;

-- name: FindNearbyCaptains :many
SELECT id, name, phone, vehicle_type, rating, acceptance_rate, ST_X(location::geometry)::float8 as longitude, ST_Y(location::geometry)::float8 as latitude
FROM captains
WHERE kyc_status = 'approved'
  AND vehicle_type = $1
  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
ORDER BY rating DESC;

-- name: GetAdminUserByEmail :one
SELECT * FROM admin_users WHERE email = $1;

-- name: CreateAdminUser :one
INSERT INTO admin_users (email, password_hash, role, name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreateRide :one
INSERT INTO rides (rider_id, status, pickup_location, drop_location, vehicle_type, estimated_fare, payment_mode)
VALUES ($1, 'requested', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8)
RETURNING *;

-- name: GetRideByID :one
SELECT * FROM rides WHERE id = $1;

-- name: UpdateRideStatus :one
UPDATE rides 
SET status = $2,
    captain_id = COALESCE($3, captain_id),
    final_fare = COALESCE($4, final_fare),
    payment_status = COALESCE($5, payment_status),
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: CreateRideStatusHistory :exec
INSERT INTO ride_status_history (ride_id, status, changed_by, reason)
VALUES ($1, $2, $3, $4);

-- name: GetRideHistoryForRider :many
SELECT * FROM rides WHERE rider_id = $1 ORDER BY created_at DESC;

-- name: GetRideHistoryForCaptain :many
SELECT * FROM rides WHERE captain_id = $1 ORDER BY created_at DESC;

-- name: CreateWalletTransaction :exec
INSERT INTO wallet_transactions (captain_id, amount, type, description)
VALUES ($1, $2, $3, $4);

-- name: GetWalletTransactions :many
SELECT * FROM wallet_transactions WHERE captain_id = $1 ORDER BY created_at DESC;

-- name: GetPricingRule :one
SELECT * FROM pricing_rules WHERE city = $1 AND vehicle_type = $2;
