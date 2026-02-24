/**
 * @module interface
 * @description Core AI provider interface, shared types, and provider registry.
 *
 * This module defines the pluggable AI provider system used by VibeFrame.
 * It exports the {@link AIProvider} interface that all providers must implement,
 * the {@link AIProviderRegistry} for managing multiple providers, capability
 * types, and all shared request/response types for video generation,
 * transcription, editing, and content analysis.
 */

export * from "./types.js";
export * from "./registry.js";
