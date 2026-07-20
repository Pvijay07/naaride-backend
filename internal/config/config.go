package config

import (
	"os"
)

type Config struct {
	DatabaseURL      string
	RedisURL         string
	NatsURL          string
	JWTSecret        string
	RazorpayKeyID    string
	RazorpaySecret   string
	TwilioSID        string
	TwilioAuthToken  string
	TwilioPhone      string
	GoogleMapsKey    string
	Port             string
}

func LoadConfig() *Config {
	return &Config{
		DatabaseURL:      getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/naaride?sslmode=disable"),
		RedisURL:         getEnv("REDIS_URL", "redis://localhost:6379/0"),
		NatsURL:          getEnv("NATS_URL", "nats://localhost:4222"),
		JWTSecret:        getEnv("JWT_SECRET", "super-secret-jwt-key"),
		RazorpayKeyID:    getEnv("RAZORPAY_KEY_ID", "rzp_test_key"),
		RazorpaySecret:   getEnv("RAZORPAY_SECRET", "rzp_test_secret"),
		TwilioSID:        getEnv("TWILIO_ACCOUNT_SID", "ACxxxx"),
		TwilioAuthToken:  getEnv("TWILIO_AUTH_TOKEN", "auth_token"),
		TwilioPhone:      getEnv("TWILIO_PHONE_NUMBER", "+1234567890"),
		GoogleMapsKey:    getEnv("GOOGLE_MAPS_KEY", "gmaps_key"),
		Port:             getEnv("PORT", "8080"),
	}
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
