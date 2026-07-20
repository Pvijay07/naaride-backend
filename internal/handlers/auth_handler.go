package handlers

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"math/big"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/naaride-clone/backend/internal/config"
	"github.com/naaride-clone/backend/internal/middleware"
	"github.com/naaride-clone/backend/internal/repository"
	"github.com/naaride-clone/backend/internal/services"
)

type AuthHandler struct {
	repo        *repository.Repository
	rdb         *redis.Client
	smsProvider services.SMSProvider
	cfg         *config.Config
}

func NewAuthHandler(repo *repository.Repository, rdb *redis.Client, sms services.SMSProvider, cfg *config.Config) *AuthHandler {
	return &AuthHandler{
		repo:        repo,
		rdb:         rdb,
		smsProvider: sms,
		cfg:         cfg,
	}
}

type OTPSendRequest struct {
	Phone string `json:"phone"`
	Role  string `json:"role"`
}

type OTPVerifyRequest struct {
	Phone string `json:"phone"`
	Role  string `json:"role"`
	OTP   string `json:"otp"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type AdminLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) SendOTP(c *fiber.Ctx) error {
	var req OTPSendRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Invalid request body",
			},
		})
	}

	if req.Phone == "" || (req.Role != "rider" && req.Role != "captain") {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Valid phone number and role (rider or captain) are required",
			},
		})
	}

	ctx := context.Background()

	// Rate limiting: 3 requests per phone per 10 minutes
	limitKey := fmt.Sprintf("otp_limit:%s", req.Phone)
	count, err := h.rdb.Get(ctx, limitKey).Int()
	if err == redis.Nil {
		h.rdb.Set(ctx, limitKey, 1, 10*time.Minute)
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "SERVER_ERROR",
				"message": "Redis error",
			},
		})
	} else if count >= 3 {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "TOO_MANY_REQUESTS",
				"message": "Rate limit exceeded. Try again after 10 minutes.",
			},
		})
	} else {
		h.rdb.Incr(ctx, limitKey)
	}

	// Generate 6-digit OTP
	otp, _ := generateOTP()

	// Store OTP in Redis (5 min TTL)
	otpKey := fmt.Sprintf("otp:%s:%s", req.Role, req.Phone)
	err = h.rdb.Set(ctx, otpKey, otp, 5*time.Minute).Err()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "SERVER_ERROR",
				"message": "Failed to store OTP",
			},
		})
	}

	// Send OTP
	_ = h.smsProvider.SendOTP(req.Phone, otp)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"message": "OTP sent successfully",
		},
	})
}

func (h *AuthHandler) VerifyOTP(c *fiber.Ctx) error {
	var req OTPVerifyRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Invalid request body",
			},
		})
	}

	ctx := context.Background()
	otpKey := fmt.Sprintf("otp:%s:%s", req.Role, req.Phone)
	storedOTP, err := h.rdb.Get(ctx, otpKey).Result()
	if err == redis.Nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "INVALID_OTP",
				"message": "OTP expired or invalid",
			},
		})
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "SERVER_ERROR",
				"message": "Redis error",
			},
		})
	}

	if storedOTP != req.OTP {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "INVALID_OTP",
				"message": "Incorrect OTP",
			},
		})
	}

	// Upsert entity
	var id string
	if req.Role == "rider" {
		u, err := h.repo.UpsertUser(ctx, req.Phone, sql.NullString{String: "Rider", Valid: true}, sql.NullString{})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "SERVER_ERROR",
					"message": err.Error(),
				},
			})
		}
		id = u.ID.String()
	} else {
		cap, err := h.repo.UpsertCaptain(ctx, req.Phone, sql.NullString{String: "Captain", Valid: true}, "bike", "approved")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "SERVER_ERROR",
					"message": err.Error(),
				},
			})
		}
		id = cap.ID.String()
	}

	// Issue Tokens
	accessToken, refreshToken, err := h.generateTokenPair(id, req.Role)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "SERVER_ERROR",
				"message": "Token generation failed",
			},
		})
	}

	// Clean up Redis keys
	h.rdb.Del(ctx, otpKey)
	h.rdb.Del(ctx, fmt.Sprintf("otp_limit:%s", req.Phone))

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"access_token":  accessToken,
			"refresh_token": refreshToken,
		},
	})
}

func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
	var req RefreshRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Invalid request body",
			},
		})
	}

	claims := &middleware.JWTClaims{}
	token, err := jwt.ParseWithClaims(req.RefreshToken, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(h.cfg.JWTSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "INVALID_TOKEN",
				"message": "Invalid or expired refresh token",
			},
		})
	}

	accessToken, refreshToken, err := h.generateTokenPair(claims.UserID, claims.Role)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "SERVER_ERROR",
				"message": "Token regeneration failed",
			},
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"access_token":  accessToken,
			"refresh_token": refreshToken,
		},
	})
}

func (h *AuthHandler) AdminLogin(c *fiber.Ctx) error {
	var req AdminLoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Invalid request body",
			},
		})
	}

	admin, err := h.repo.GetAdminUserByEmail(context.Background(), req.Email)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "UNAUTHORIZED",
				"message": "Invalid email or password",
			},
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "UNAUTHORIZED",
				"message": "Invalid email or password",
			},
		})
	}

	accessToken, refreshToken, err := h.generateTokenPair(admin.ID.String(), admin.Role)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "SERVER_ERROR",
				"message": "Token generation failed",
			},
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"access_token":  accessToken,
			"refresh_token": refreshToken,
		},
	})
}

func (h *AuthHandler) generateTokenPair(userID, role string) (string, string, error) {
	// Access token (2 hours)
	accessClaims := middleware.JWTClaims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	aToken, err := accessToken.SignedString([]byte(h.cfg.JWTSecret))
	if err != nil {
		return "", "", err
	}

	// Refresh token (30 days)
	refreshClaims := middleware.JWTClaims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	rToken, err := refreshToken.SignedString([]byte(h.cfg.JWTSecret))
	if err != nil {
		return "", "", err
	}

	return aToken, rToken, nil
}

func generateOTP() (string, error) {
	max := big.NewInt(900000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()+100000), nil
}
