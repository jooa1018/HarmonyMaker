# Render-compatible provider image. HarmonyMaker's Vercel build ignores this file.
FROM ubuntu:24.04
ARG AUDIVERIS_VERSION=5.10.2
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 python3-venv \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-kor poppler-utils \
    libgl1 libglib2.0-0 libasound2t64 libfreetype6 \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/share/desktop-directories /usr/share/mime/packages /usr/share/icons/hicolor /usr/share/applications \
    && curl -fsSL -o /tmp/audiveris.deb \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" \
    && apt-get update && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
    && rm -f /tmp/audiveris.deb && rm -rf /var/lib/apt/lists/* \
    && AUD="$(find /opt -maxdepth 4 -type f -name 'Audiveris' -perm -111 | head -n 1)" \
    && test -n "$AUD" && ln -s "$AUD" /usr/local/bin/audiveris
WORKDIR /app
COPY services/audiveris-provider/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY services/audiveris-provider/app.py \
     services/audiveris-provider/demo_app.py \
     services/audiveris-provider/musicxml_output.py \
     services/audiveris-provider/provider_entrypoint.py \
     services/audiveris-provider/audiveris-wrapper.sh \
     services/audiveris-provider/recognition_preprocess.py \
     /app/
ENV PATH=/opt/venv/bin:$PATH \
    AUDIVERIS_BIN=/app/audiveris-wrapper.sh \
    AUDIVERIS_VERSION=${AUDIVERIS_VERSION} \
    HM_AUDIVERIS_DATA_DIR=/data \
    HM_AUDIVERIS_OCR_LANGUAGES=eng+kor \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata \
    JAVA_TOOL_OPTIONS="-Xmx384m -Djava.awt.headless=true" \
    HOME=/data/home \
    PORT=8000
RUN useradd --create-home --uid 10001 provider \
    && chmod 0755 /app/audiveris-wrapper.sh \
    && mkdir -p /data/home \
    && chown -R provider:provider /app /data
USER provider
EXPOSE 8000
CMD ["sh", "-c", "uvicorn provider_entrypoint:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
