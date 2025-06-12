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

// Environment-based log level selection
// Production defaults to INFO to reduce noise, development includes DEBUG for troubleshooting
const CURRENT_LOG_LEVEL = process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;

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
function sanitizeData(data) {
    if (typeof data !== 'object' || data === null) return data;
    
    // List of field names that commonly contain sensitive information
    const sensitive = ['token', 'secret', 'key', 'password', 'did', 'sessionId'];
    const sanitized = { ...data };
    
    for (const key of Object.keys(sanitized)) {
        if (sensitive.some(s => key.toLowerCase().includes(s))) {
            // Replace sensitive values with redaction marker
            sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object') {
            // Recursively sanitize nested objects
            sanitized[key] = sanitizeData(sanitized[key]);
        }
    }
    
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
    return {
        timestamp,
        level,
        message,
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