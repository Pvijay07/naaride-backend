package db

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

type Queries struct {
	db DBTX
}

func New(db DBTX) *Queries {
	return &Queries{db: db}
}

func (q *Queries) WithTx(tx pgx.Tx) *Queries {
	return &Queries{db: tx}
}

type User struct {
	ID        uuid.UUID
	Phone     string
	Name      sql.NullString
	Email     sql.NullString
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Captain struct {
	ID                  uuid.UUID
	Phone               string
	Name                sql.NullString
	VehicleType         string
	KycStatus           string
	KycRejectionReason  sql.NullString
	Rating              sql.NullFloat64
	AcceptanceRate      sql.NullFloat64
	Location            interface{}
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type AdminUser struct {
	ID           uuid.UUID
	Email        string
	PasswordHash string
	Role         string
	Name         string
	CreatedAt    time.Time
}

func (q *Queries) GetUserByPhone(ctx context.Context, phone string) (User, error) {
	row := q.db.QueryRow(ctx, "SELECT id, phone, name, email, created_at, updated_at FROM users WHERE phone = $1", phone)
	var u User
	err := row.Scan(&u.ID, &u.Phone, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

func (q *Queries) UpsertUser(ctx context.Context, phone string, name sql.NullString, email sql.NullString) (User, error) {
	row := q.db.QueryRow(ctx, `
		INSERT INTO users (phone, name, email, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (phone) DO UPDATE 
		SET name = COALESCE(users.name, EXCLUDED.name),
			email = COALESCE(users.email, EXCLUDED.email),
			updated_at = NOW()
		RETURNING id, phone, name, email, created_at, updated_at
	`, phone, name, email)
	var u User
	err := row.Scan(&u.ID, &u.Phone, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

func (q *Queries) GetCaptainByPhone(ctx context.Context, phone string) (Captain, error) {
	row := q.db.QueryRow(ctx, "SELECT id, phone, name, vehicle_type, kyc_status, created_at, updated_at FROM captains WHERE phone = $1", phone)
	var c Captain
	err := row.Scan(&c.ID, &c.Phone, &c.Name, &c.VehicleType, &c.KycStatus, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func (q *Queries) UpsertCaptain(ctx context.Context, phone string, name sql.NullString, vehicleType string, kycStatus string) (Captain, error) {
	row := q.db.QueryRow(ctx, `
		INSERT INTO captains (phone, name, vehicle_type, kyc_status, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (phone) DO UPDATE 
		SET name = COALESCE(captains.name, EXCLUDED.name),
			vehicle_type = EXCLUDED.vehicle_type,
			kyc_status = COALESCE(captains.kyc_status, EXCLUDED.kyc_status),
			updated_at = NOW()
		RETURNING id, phone, name, vehicle_type, kyc_status, created_at, updated_at
	`, phone, name, vehicleType, kycStatus)
	var c Captain
	err := row.Scan(&c.ID, &c.Phone, &c.Name, &c.VehicleType, &c.KycStatus, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func (q *Queries) GetAdminUserByEmail(ctx context.Context, email string) (AdminUser, error) {
	row := q.db.QueryRow(ctx, "SELECT id, email, password_hash, role, name, created_at FROM admin_users WHERE email = $1", email)
	var a AdminUser
	err := row.Scan(&a.ID, &a.Email, &a.PasswordHash, &a.Role, &a.Name, &a.CreatedAt)
	return a, err
}

func (q *Queries) CreateAdminUser(ctx context.Context, email string, passwordHash string, role string, name string) (AdminUser, error) {
	row := q.db.QueryRow(ctx, `
		INSERT INTO admin_users (email, password_hash, role, name)
		VALUES ($1, $2, $3, $4)
		RETURNING id, email, password_hash, role, name, created_at
	`, email, passwordHash, role, name)
	var a AdminUser
	err := row.Scan(&a.ID, &a.Email, &a.PasswordHash, &a.Role, &a.Name, &a.CreatedAt)
	return a, err
}
