package mtproto

import (
	"testing"
	"github.com/gotd/td/tg"
)

func TestGetInputPeer(t *testing.T) {
	// private chat -> InputPeerUser
	if _, ok := getInputPeer(1336050970).(*tg.InputPeerUser); !ok {
		t.Errorf("positive id must map to InputPeerUser, got %T", getInputPeer(1336050970))
	}
	// supergroup/channel -> InputPeerChannel
	if _, ok := getInputPeer(-1001234567890).(*tg.InputPeerChannel); !ok {
		t.Errorf("supergroup id must map to InputPeerChannel, got %T", getInputPeer(-1001234567890))
	}
	// legacy group -> InputPeerChat
	if _, ok := getInputPeer(-987654).(*tg.InputPeerChat); !ok {
		t.Errorf("legacy group id must map to InputPeerChat, got %T", getInputPeer(-987654))
	}
}
