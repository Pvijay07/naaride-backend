package main

import (
	"context"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/naaride-clone/backend/internal/config"
	"github.com/naaride-clone/backend/internal/handlers"
	"github.com/naaride-clone/backend/internal/repository"
	"github.com/naaride-clone/backend/internal/services"
)

func main() {
	cfg := config.LoadConfig()

	// Connect to Postgres
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v\n", err)
	}
	defer conn.Close(ctx)
	log.Println("Connected to database successfully")

	// Connect to Redis
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("Invalid redis URL: %v\n", err)
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis unavailable: %v\n", err)
	}
	log.Println("Connected to Redis successfully")

	// Setup SMS provider
	sms := services.NewMockSMSProvider()

	// Setup Repo
	repo := repository.NewRepository(conn)

	// Setup Auth Handler
	authHandler := handlers.NewAuthHandler(repo, rdb, sms, cfg)

	// Fiber app setup
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "INTERNAL_ERROR",
					"message": err.Error(),
				},
			})
		},
	})

	app.Use(logger.New())

	// Health Check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "healthy"})
	})

	// Public Routes
	api := app.Group("/api/v1")
	auth := api.Group("/auth")
	auth.Post("/otp/send", authHandler.SendOTP)
	auth.Post("/otp/verify", authHandler.VerifyOTP)
	auth.Post("/refresh", authHandler.Refresh)

	admin := api.Group("/admin")
	admin.Post("/auth/login", authHandler.AdminLogin)

	log.Printf("Server starting on port %s...\n", cfg.Port)
	if err := app.Listen(fmt.Sprintf(":%s", cfg.Port)); err != nil {
		log.Fatalf("Server error: %v\n", err)
	}
}
