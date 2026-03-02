/**
 * Application Logging System
 * 
 * This module provides a structured logging system with security-conscious features
 * for the Storacha delegation management application.
 * 
 * Key Features:
 * - Configurable log levels (ERROR, WARN, INFO, DEBUG)
 * - Automatic sanitization of sensitive data
 * - Environment-based default configuration
 * - Structured JSON output for easy parsing
 * - Consistent timestamp formatting
 * 
 * Security Features:
 * - Automatically redacts common sensitive fields (tokens, secrets, DIDs, etc.)
 * - Recursive sanitization of nested objects
 * - Production-safe defaults
 * 
 * The logger outputs structured JSON to facilitate log aggregation and analysis
 * in production environments.
 */

// Log level hierarchy - lower numbers indicate higher priority
const LOG_LEVELS = {
    ERROR: 0,  // Critical errors that require immediate attention
    WARN: 1,   // Warnings about potential issues
    INFO: 2,   // General information about application flow
    DEBUG: 3   // Detailed debugging information
};

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PARTS = [
    'token',
    'secret',
    'password',
    'session',
    'cookie',
    'authorization',
    'signature',
    'challenge',
    'delegation',
    'agentdata',
    'privatekey',
    'apikey',
    'email',
    'did',
    'ipaddress',
    'useragent'
];

const STRING_REDACTIONS = [
    {
        regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        replacement: '[REDACTED_EMAIL]'
    },
    {
        regex: /did:[a-z0-9]+:[A-Za-z0-9._:-]+/gi,
        replacement: '[REDACTED_DID]'
    },
    {
        regex: /(\b(?:authorization|x-auth-secret|x-session-id)\b\s*[:=]\s*)([^\s,;]+)/gi,
        replacement: '$1[REDACTED]'
    },
    {
        regex: /(\b(?:token|secret|password|signature|challenge|api[_-]?key|session)\b[^:=\n\r]{0,20}[:=]\s*)([^\s,;]+)/gi,
        replacement: '$1[REDACTED]'
    },
    {
        regex: /\b[a-f0-9]{32,}\b/gi,
        replacement: '[REDACTED_HEX]'
    },
    {
        regex: /\b[A-Za-z0-9+/_=-]{64,}\b/g,
        replacement: '[REDACTED_BLOB]'
    }
];

function resolveLogLevel(rawLevel, fallbackLevel) {
    if (rawLevel === undefined || rawLevel === null || rawLevel === '') {
        return fallbackLevel;
    }

    const normalized = String(rawLevel).trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized)) {
        return LOG_LEVELS[normalized];
    }

    const numeric = Number(normalized);
    if (Number.isInteger(numeric) && numeric >= LOG_LEVELS.ERROR && numeric <= LOG_LEVELS.DEBUG) {
        return numeric;
    }

    return fallbackLevel;
}

// Environment-based log level selection
// Production defaults to WARN to minimize potentially sensitive noise.
const DEFAULT_LOG_LEVEL = process.env.NODE_ENV === 'production' ? LOG_LEVELS.WARN : LOG_LEVELS.DEBUG;
let CURRENT_LOG_LEVEL = resolveLogLevel(process.env.LOG_LEVEL, DEFAULT_LOG_LEVEL);

function isSensitiveKey(key) {
    const normalized = String(key).toLowerCase();
    return SENSITIVE_KEY_PARTS.some((sensitivePart) => normalized.includes(sensitivePart));
}

function sanitizeString(value) {
    let sanitized = value;
    for (const { regex, replacement } of STRING_REDACTIONS) {
        sanitized = sanitized.replace(regex, replacement);
    }
    return sanitized;
}

/**
 * Sanitizes sensitive data from log entries to prevent credential leakage
 * 
 * This function recursively processes objects to identify and redact fields
 * that commonly contain sensitive information like tokens, passwords, or DIDs.
 * This is crucial for security compliance and preventing accidental credential exposure.
 * 
 * @param {any} data - The data to sanitize
 * @returns {any} - The sanitized data with sensitive fields redacted
 */
function sanitizeData(data, seen = new WeakSet()) {
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
        return sanitizeString(data);
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
        return data;
    }

    if (typeof data === 'bigint') {
        return data.toString();
    }

    if (data instanceof Error) {
        return {
            name: data.name,
            message: sanitizeString(data.message),
            stack: process.env.NODE_ENV === 'development' ? sanitizeString(data.stack || '') : undefined
        };
    }

    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
        return '[REDACTED_BINARY]';
    }

    if (Array.isArray(data)) {
        return data.map((item) => sanitizeData(item, seen));
    }

    if (typeof data !== 'object') {
        return data;
    }

    if (seen.has(data)) {
        return '[Circular]';
    }
    seen.add(data);

    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        if (isSensitiveKey(key)) {
            sanitized[key] = REDACTED;
            continue;
        }

        sanitized[key] = sanitizeData(value, seen);
    }
    seen.delete(data);

    return sanitized;
}

/**
 * Formats log messages with consistent structure and sanitization
 * 
 * Creates a structured log entry with:
 * - ISO timestamp for precise timing
 * - Log level for filtering
 * - Message content
 * - Sanitized additional data
 * 
 * @param {number} level - The log level (from LOG_LEVELS)
 * @param {string} message - The primary log message
 * @param {object} data - Additional context data
 * @returns {object} - Formatted log entry
 */
function formatMessage(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const sanitizedData = sanitizeData(data);
    const safeMessage = sanitizeString(String(message ?? ''));
    return {
        timestamp,
        level,
        message: safeMessage,
        ...sanitizedData
    };
}

/**
 * Core logging function that handles level filtering and output routing
 * 
 * Only logs messages that meet the current log level threshold and routes
 * them to the appropriate console method based on severity.
 * 
 * @param {number} level - The message log level
 * @param {string} message - The log message
 * @param {object} data - Additional context data
 */
function log(level, message, data = {}) {
    if (level <= CURRENT_LOG_LEVEL) {
        const formatted = formatMessage(level, message, data);
        
        // Route to appropriate console method based on severity
        switch (level) {
            case LOG_LEVELS.ERROR:
                console.error(JSON.stringify(formatted));
                break;
            case LOG_LEVELS.WARN:
                console.warn(JSON.stringify(formatted));
                break;
            case LOG_LEVELS.INFO:
                console.info(JSON.stringify(formatted));
                break;
            case LOG_LEVELS.DEBUG:
                console.debug(JSON.stringify(formatted));
                break;
        }
    }
}

/**
 * Logger API - Provides convenient methods for different log levels
 * 
 * This is the main interface used throughout the application for logging.
 * Each method corresponds to a specific log level and accepts a message
 * plus optional context data.
 */
export const logger = {
    // Log critical errors that require immediate attention
    error: (message, data) => log(LOG_LEVELS.ERROR, message, data),
    
    // Log warnings about potential issues or unexpected conditions
    warn: (message, data) => log(LOG_LEVELS.WARN, message, data),
    
    // Log general information about application flow and operations
    info: (message, data) => log(LOG_LEVELS.INFO, message, data),
    
    // Log detailed debugging information for troubleshooting
    debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data),
    
    // Export log levels for external use (e.g., conditional logging)
    LOG_LEVELS,
    
    // Allow runtime log level changes for dynamic debugging
    setLogLevel: (level) => {
        if (Object.values(LOG_LEVELS).includes(level)) {
            CURRENT_LOG_LEVEL = level;
        }
    }
};

// Exported for tests and for optional call-site pre-sanitization.
export function sanitizeForLog(data) {
    return sanitizeData(data);
}

export function sanitizeLogMessage(message) {
    return sanitizeString(String(message ?? ''));
}
