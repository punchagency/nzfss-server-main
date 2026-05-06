import dns from "dns";
import mongoose from "mongoose";
import { logger } from "./logger";

const MAX_RETRIES = 5;
const RETRY_INTERVAL = 5000; // 5 seconds
function getMongoConnectionUris(): string[] {
  const primaryUri = (process.env.MONGODB_STRING || process.env.MONGODB_URI || "").trim();
  if (!primaryUri) {
    throw new Error('MONGODB_STRING (or MONGODB_URI) environment variable is not set');
  }

  const fallbackUri = (process.env.MONGODB_STRING_FALLBACK || process.env.MONGODB_URI_FALLBACK || "").trim();
  if (!fallbackUri || fallbackUri === primaryUri) {
    return [primaryUri];
  }

  return [primaryUri, fallbackUri];
}

function isSrvQueryError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "MongoServerSelectionError" &&
    typeof error.message === "string" &&
    error.message.includes("querySrv");
}

function configureMongoDnsResolvers(): void {
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "")
    .split(",")
    .map(server => server.trim())
    .filter(Boolean);

  if (!dnsServers.length) {
    return;
  }

  dns.setServers(dnsServers);
  logger.info(`Using custom DNS servers for MongoDB lookup: ${dnsServers.join(", ")}`);
}

function getConnectionOptions() {
  return {
    serverSelectionTimeoutMS: 30000, // Increased timeout to 30s
    socketTimeoutMS: 60000, // Increased socket timeout to 60s
    connectTimeoutMS: 30000, // Connection timeout
    maxPoolSize: 10, // Limit connection pool
    minPoolSize: 1, // Minimum connections
    maxIdleTimeMS: 30000, // Close idle connections after 30s
    family: 4, // Use IPv4, skip trying IPv6
    retryWrites: true,
    retryReads: true,
    w: 'majority' // Write concern
  } as const;
}

function registerConnectionEventHandlers(): void {
  // Set up connection event handlers
  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function connectToMongo(
  retryCount = 0,
  connectionIndex = 0,
  connectionUris = getMongoConnectionUris()
): Promise<typeof mongoose> {
  try {
    const currentUri = connectionUris[connectionIndex];
    if (!currentUri) {
      throw new Error(`MongoDB connection URI at index ${connectionIndex} is missing`);
    }

    const labels = connectionUris.map((_, index) => index === 0 ? "primary" : "fallback");
    const uriLabel = labels[connectionIndex] ?? `connection-${connectionIndex}`;
    logger.info(`Connecting to MongoDB (${uriLabel})`);
    configureMongoDnsResolvers();

    const connection = await mongoose.connect(currentUri, getConnectionOptions());
    registerConnectionEventHandlers();

    // Handle process termination
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        logger.error('Error during MongoDB disconnection:', err);
        process.exit(1);
      }
    });

    return connection;
  } catch (error) {
    const isSrvFailure = isSrvQueryError(error);
    const hasFallback = connectionIndex + 1 < connectionUris.length;
    logger.error(`MongoDB connection attempt ${retryCount + 1} (${connectionIndex}) failed:`, error);

    if (isSrvFailure && hasFallback) {
      logger.warn("SRV DNS lookup failed. Retrying with non-SRV fallback URI (MONGODB_STRING_FALLBACK or MONGODB_URI_FALLBACK).");
      return connectToMongo(retryCount, connectionIndex + 1, connectionUris);
    }

    if (retryCount < MAX_RETRIES) {
      logger.info(`Retrying connection in ${RETRY_INTERVAL/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await wait(RETRY_INTERVAL);
      return connectToMongo(retryCount + 1);
    }

    logger.error('Max retries reached. Could not connect to MongoDB');
    throw error; // Let the caller handle the final error
  }
}