source ./.env
git pull
source "./venv/bin/activate"
sudo systemctl restart ${SERVICE_NAME}
sudo journalctl -u ${SERVICE_NAME} -f