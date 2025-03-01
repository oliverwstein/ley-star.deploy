FROM node:18-slim

WORKDIR /app

# Copy package files and install dependencies for the main app
COPY package*.json ./
RUN npm install

# Copy entire project
COPY . .

# Install frontend dependencies and build the frontend
RUN cd src/frontend && npm install && npm run build

# Set production environment
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD ["npm", "start"]