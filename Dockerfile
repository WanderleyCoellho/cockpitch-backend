# Use a Node.js base image
FROM node:20-slim

# Instala o OpenSSL, dependência obrigatória para o motor do Prisma
RUN apt-get update -y && apt-get install -y openssl

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Generate the Prisma client
RUN npx prisma generate

# Dá permissão de execução para o nosso script de inicialização
RUN chmod +x ./entrypoint.sh

# Expose the port
EXPOSE 3333

# Define o script como o comando principal de inicialização
CMD ["./entrypoint.sh"]