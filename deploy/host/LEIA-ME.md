# HTTPS do app (nginx no servidor)

O nginx do servidor recebe as portas 80 e 443 e repassa para o container (`127.0.0.1:5180`). O certificado é do Let's Encrypt (certbot).

| Arquivo | Vai para |
|---|---|
| `app.mundodosiphones.com.br.conf` | `/etc/nginx/sites-available/` (e link em `sites-enabled/`) |
| `emitir-cert-app.sh` | `/usr/local/bin/` (755) |
| `emitir-cert-app.service`, `.timer` | `/etc/systemd/system/` |

O timer espera o DNS apontar para o servidor, pede o certificado e se desliga. Se falhar 3 vezes, para (limite do Let's Encrypt).

No `.env` do servidor, `ORIGEM` aceita mais de um endereço, separados por vírgula. O front de produção é gerado com `VITE_API_URL=https://app.mundodosiphones.com.br`.

O nginx do container confia no `X-Real-IP` só quando o pedido vem da rede do Docker (`deploy/nginx.conf`): assim o IP gravado como prova de assinatura é o do cliente e não pode ser forjado.
