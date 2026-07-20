package services

import "fmt"

type SMSProvider interface {
	SendOTP(phone, code string) error
}

type MockSMSProvider struct{}

func NewMockSMSProvider() SMSProvider {
	return &MockSMSProvider{}
}

func (m *MockSMSProvider) SendOTP(phone, code string) error {
	// Local development mock printout
	fmt.Printf("[SMS MOCK] Sending 6-digit OTP code %s to phone %s\n", code, phone)
	return nil
}
