source ./venv/bin/activate
uvicorn server:app --reload --host 0.0.0.0 --port 8000 --workers 1