#!/bin/sh

# O parâmetro 'set -e' faz com que o script pare imediatamente se ocorrer algum erro
set -e

echo "Executando as migrações do banco de dados..."
npx prisma migrate deploy

echo "Iniciando a aplicação..."
# O 'exec' garante que o processo do Node assuma o controle do contêiner, 
# o que é uma boa prática para o Railway gerenciar a memória e o encerramento correto.
exec node dist/server.js