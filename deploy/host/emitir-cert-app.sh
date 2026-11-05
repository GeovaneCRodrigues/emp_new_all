#!/bin/sh
# Emite o certificado HTTPS do app assim que o DNS apontar para este servidor. Roda por timer; se desliga quando termina.
DOM=app.mundodosiphones.com.br
IP=161.97.117.80
FALHAS=/var/lib/emitir-cert-app.falhas
log() { echo "$(date '+%F %T') $*"; }

if [ -d "/etc/letsencrypt/live/$DOM" ]; then
  log "certificado já existe: desligando o timer"
  systemctl disable --now emitir-cert-app.timer
  exit 0
fi
for r in 1.1.1.1 8.8.8.8; do
  if [ "$(dig +short @$r $DOM A | head -n1)" != "$IP" ]; then log "DNS ainda não aponta para $IP (visto por $r)"; exit 0; fi
done
n=$(cat "$FALHAS" 2>/dev/null || echo 0)
if [ "$n" -ge 3 ]; then log "3 tentativas falharam: parei para não estourar o limite do Let's Encrypt. Veja o log do certbot."; systemctl disable --now emitir-cert-app.timer; exit 1; fi
log "DNS ok, pedindo o certificado"
if certbot --nginx -d "$DOM" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  log "certificado emitido"; rm -f "$FALHAS"; systemctl disable --now emitir-cert-app.timer
else
  echo $((n + 1)) > "$FALHAS"; log "falhou (tentativa $((n + 1)) de 3)"
fi
