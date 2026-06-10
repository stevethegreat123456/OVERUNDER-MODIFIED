FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy full application code
COPY . .

# Build the client 
RUN npm run build

# Expose port (must match server.ts port)
EXPOSE 3000

# Start server
CMD ["node", "--experimental-strip-types", "server.ts"]
