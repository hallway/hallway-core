FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app
RUN npm init -y > /dev/null 2>&1 && npm install playwright@1.52.0 --save > /dev/null 2>&1

COPY server.js /app/server.js

EXPOSE 3000
CMD ["node", "/app/server.js"]
