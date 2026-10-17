package utils

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

var privateCIDRs []*net.IPNet

func init() {
	cidrs := []string{
		"127.0.0.0/8",    // IPv4 loopback
		"10.0.0.0/8",     // RFC1918
		"172.16.0.0/12",  // RFC1918
		"192.168.0.0/16", // RFC1918
		"169.254.0.0/16", // RFC3927 link-local
		"0.0.0.0/8",      // Current network
		"224.0.0.0/4",    // Multicast
		"240.0.0.0/4",    // Reserved
		"::1/128",        // IPv6 loopback
		"fc00::/7",       // Unique Local
		"fe80::/10",      // Link-local
		"::/128",         // Unspecified
	}
	for _, cidr := range cidrs {
		_, ipNet, err := net.ParseCIDR(cidr)
		if err == nil {
			privateCIDRs = append(privateCIDRs, ipNet)
		}
	}
}

func ValidateSafeURL(rawURL string) (bool, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false, fmt.Errorf("invalid URL: %w", err)
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return false, fmt.Errorf("unsupported URL protocol '%s'", scheme)
	}

	hostname := u.Hostname()
	if hostname == "" {
		return false, fmt.Errorf("missing hostname")
	}

	lowerHost := strings.ToLower(hostname)
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".localhost") || strings.HasSuffix(lowerHost, ".local") {
		return false, fmt.Errorf("localhost access forbidden")
	}

	// Check if hostname is direct IP
	if ip := net.ParseIP(hostname); ip != nil {
		if isPrivateIP(ip) {
			return false, fmt.Errorf("private IP address forbidden")
		}
		return true, nil
	}

	// Resolve IP addresses via DNS
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return false, fmt.Errorf("failed to resolve hostname '%s': %w", hostname, err)
	}
	if len(ips) == 0 {
		return false, fmt.Errorf("no IP addresses found for host '%s'", hostname)
	}

	for _, ip := range ips {
		if isPrivateIP(ip) {
			return false, fmt.Errorf("resolved to private IP address: %s", ip.String())
		}
	}

	return true, nil
}

func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	for _, block := range privateCIDRs {
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

func IsSafeHTTPS(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return strings.ToLower(u.Scheme) == "https"
}

