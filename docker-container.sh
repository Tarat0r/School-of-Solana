#!/usr/bin/bash

docker run -it --name school-of-solana \
  -p 8899:8899 -p 9900:9900 -p 8000:8000 -p 8080:8080 \
  -v "/home/v/Documents/Solana course":/workspace \
  -w /workspace \
  ackeeblockchain/school-of-solana:latest
