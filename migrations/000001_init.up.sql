-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(15) UNIQUE NOT NULL,
    name VARCHAR(100),
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Captains table
CREATE TYPE vehicle_type AS ENUM ('bike', 'auto', 'cab');
CREATE TYPE kyc_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE captains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(15) UNIQUE NOT NULL,
    name VARCHAR(100),
    vehicle_type vehicle_type NOT NULL,
    kyc_status kyc_status NOT NULL DEFAULT 'pending',
    kyc_rejection_reason TEXT,
    rating NUMERIC(3,2) DEFAULT 5.0,
    acceptance_rate NUMERIC(5,2) DEFAULT 100.0,
    location GEOGRAPHY(POINT, 4326),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Rides table
CREATE TYPE ride_status AS ENUM ('requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled');
CREATE TYPE payment_mode AS ENUM ('cash', 'online');
CREATE TYPE payment_status AS ENUM ('pending', 'captured', 'failed');

CREATE TABLE rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rider_id UUID NOT NULL REFERENCES users(id),
    captain_id UUID REFERENCES captains(id),
    status ride_status NOT NULL DEFAULT 'requested',
    pickup_location GEOGRAPHY(POINT, 4326) NOT NULL,
    drop_location GEOGRAPHY(POINT, 4326) NOT NULL,
    vehicle_type vehicle_type NOT NULL,
    estimated_fare NUMERIC(8,2) NOT NULL,
    final_fare NUMERIC(8,2),
    payment_mode payment_mode NOT NULL DEFAULT 'cash',
    payment_status payment_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Ride Status History table
CREATE TABLE ride_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    status ride_status NOT NULL,
    changed_by VARCHAR(50) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Ride Location Pings table
CREATE TABLE ride_location_pings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    pinged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Payments table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    amount NUMERIC(8,2) NOT NULL,
    status payment_status NOT NULL DEFAULT 'pending',
    razorpay_order_id VARCHAR(255),
    razorpay_payment_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Wallet Transactions table
CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    captain_id UUID NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
    amount NUMERIC(8,2) NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Ratings table
CREATE TABLE ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    rater_role VARCHAR(20) NOT NULL,
    score INT NOT NULL CHECK (score >= 1 AND score <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Pricing Rules table
CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    city VARCHAR(100) NOT NULL,
    vehicle_type vehicle_type NOT NULL,
    base_fare NUMERIC(8,2) NOT NULL,
    per_km_rate NUMERIC(8,2) NOT NULL,
    per_min_rate NUMERIC(8,2) NOT NULL,
    min_fare NUMERIC(8,2) NOT NULL,
    cancellation_fee NUMERIC(8,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(city, vehicle_type)
);

-- 10. Promo Codes table
CREATE TABLE promo_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_percentage INT NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
    max_discount NUMERIC(8,2) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Admin Users table
CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
