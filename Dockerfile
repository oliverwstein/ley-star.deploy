FROM node:18-slim

WORKDIR /app

# Copy package files and install dependencies for the main app
COPY package*.json ./
RUN npm install --production

# Copy entire project
COPY . .

# Install frontend dependencies and build the frontend
RUN cd src/frontend && npm install && npm run build

# Set production environment
ENV NODE_ENV=production

# Explicitly set the port to match Cloud Run's PORT environment variable
ENV PORT=8080
EXPOSE 8080

# Health check for container
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/api/health || exit 1

# Command to run the application directly (avoid npm which adds an extra process)
CMD ["node", "server.js"]