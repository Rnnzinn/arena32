# Imagem do servidor multiplayer (sem dependências npm)
FROM node:22-alpine
WORKDIR /app
COPY shared ./shared
COPY server ./server
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
