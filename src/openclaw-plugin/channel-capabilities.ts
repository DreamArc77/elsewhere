import type {
  ChannelCapabilityLevel,
  ChannelCapabilitySummary,
} from "../domain/types.js";

const DEFAULT_CHANNEL_CAPABILITIES: ChannelCapabilitySummary = {
  combinedPostcard: "unknown",
  mediaPostcard: "unknown",
  inboundImageSetup: "unknown",
  proactiveMessaging: "unknown",
};

const CHANNEL_CAPABILITY_MAP: Record<string, ChannelCapabilitySummary> = {
  telegram: {
    combinedPostcard: "supported",
    mediaPostcard: "supported",
    inboundImageSetup: "supported",
    proactiveMessaging: "supported",
  },
  whatsapp: {
    combinedPostcard: "supported",
    mediaPostcard: "supported",
    inboundImageSetup: "supported",
    proactiveMessaging: "supported",
  },
  discord: {
    combinedPostcard: "limited",
    mediaPostcard: "supported",
    inboundImageSetup: "supported",
    proactiveMessaging: "supported",
  },
  slack: {
    combinedPostcard: "limited",
    mediaPostcard: "supported",
    inboundImageSetup: "supported",
    proactiveMessaging: "supported",
  },
  qqbot: {
    combinedPostcard: "unsupported",
    mediaPostcard: "limited",
    inboundImageSetup: "unknown",
    proactiveMessaging: "limited",
  },
};

export function getChannelCapabilities(channel: string): ChannelCapabilitySummary {
  return CHANNEL_CAPABILITY_MAP[channel] ?? DEFAULT_CHANNEL_CAPABILITIES;
}

export function supportsCombinedPostcard(channel: string): boolean {
  return getChannelCapabilities(channel).combinedPostcard !== "unsupported";
}

export function supportsMediaPostcard(channel: string): boolean {
  return getChannelCapabilities(channel).mediaPostcard !== "unsupported";
}

export function formatChannelCapability(level: ChannelCapabilityLevel): string {
  return level;
}
