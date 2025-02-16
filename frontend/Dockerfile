# frontend/Dockerfile
# Build stage
FROM node:18 as builder

WORKDIR /app

# Copy source from the src directory where frontend was cloned
COPY src/package*.json ./
RUN npm install

# Copy the rest of the frontend source code
COPY src/ ./

# Build the app
RUN npm run build

# Production stage
FROM node:18-slim

WORKDIR /app

# Copy built assets from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Expose the port the app runs on
EXPOSE 3000

# Start the app
CMD ["node", "build"]