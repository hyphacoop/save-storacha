// Simple logger utility with log levels
const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

// Default to INFO in production, DEBUG in development
const CURRENT_LOG_LEVEL = process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;

// Sanitize sensitive data from logs
function sanitizeData(data) {
    if (typeof data !== 'object' || data === null) return data;
    
    const sensitive = ['token', 'secret', 'key', 'password', 'did', 'sessionId'];
    const sanitized = { ...data };
    
    for (const key of Object.keys(sanitized)) {
        if (sensitive.some(s => key.toLowerCase().includes(s))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object') {
            sanitized[key] = sanitizeData(sanitized[key]);
        }
    }
    
    return sanitized;
}

// Format log message with sanitization
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

// Log functions
function log(level, message, data = {}) {
    if (level <= CURRENT_LOG_LEVEL) {
        const formatted = formatMessage(level, message, data);
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

// Export logger functions
export const logger = {
    error: (message, data) => log(LOG_LEVELS.ERROR, message, data),
    warn: (message, data) => log(LOG_LEVELS.WARN, message, data),
    info: (message, data) => log(LOG_LEVELS.INFO, message, data),
    debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data),
    
    // Export log levels for external use
    LOG_LEVELS,
    
    // Allow changing log level at runtime
    setLogLevel: (level) => {
        if (Object.values(LOG_LEVELS).includes(level)) {
            CURRENT_LOG_LEVEL = level;
        }
    }
}; 