package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/naaride-clone/backend/internal/repository/db"
)

type Repository struct {
	*db.Queries
	conn *pgx.Conn
}

func NewRepository(conn *pgx.Conn) *Repository {
	return &Repository{
		Queries: db.New(conn),
		conn:    conn,
	}
}

func (r *Repository) WithTx(ctx context.Context, fn func(*db.Queries) error) error {
	tx, err := r.conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	q := r.Queries.WithTx(tx)
	if err := fn(q); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
