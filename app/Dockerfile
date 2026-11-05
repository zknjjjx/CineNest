# 适用于 x86_64(amd64) 与 ARM(arm64/armv7) 设备：基础镜像与依赖均为多架构
FROM python:3.12-slim
ARG PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
ENV TZ=Asia/Shanghai PYTHONUNBUFFERED=1
# 有预编译 wheel 的架构直接安装；没有的（如 armv7）临时装编译器构建后再卸掉
RUN pip install --no-cache-dir --only-binary=:all: -i ${PIP_INDEX} aiohttp==3.10.11 \
 || pip install --no-cache-dir --only-binary=:all: aiohttp==3.10.11 \
 || (apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
     && pip install --no-cache-dir aiohttp==3.10.11 \
     && apt-get purge -y gcc libc6-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*)
WORKDIR /app
COPY app.py collector.py vprobe.py conf.py ./
COPY static ./static
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/',timeout=4)" || exit 1
CMD ["python","app.py"]
