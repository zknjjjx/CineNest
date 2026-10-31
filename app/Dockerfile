# 适用于 x86_64(amd64) 与 ARM(arm64/armv7) 设备：基础镜像与依赖均为多架构
FROM python:3.12-slim
ARG PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
ENV TZ=Asia/Shanghai PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir -i ${PIP_INDEX} aiohttp==3.10.11 || pip install --no-cache-dir aiohttp==3.10.11
WORKDIR /app
COPY app.py collector.py ./
COPY static ./static
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/',timeout=4)" || exit 1
CMD ["python","app.py"]
