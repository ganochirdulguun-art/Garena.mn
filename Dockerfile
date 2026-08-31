FROM node:20-alpine
WORKDIR /app
# Production горим: dev-fallback (guest auth, in-memory store, reset-token лог) унтраана
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ .
EXPOSE 8080
CMD ["node", "src/index.js"]
