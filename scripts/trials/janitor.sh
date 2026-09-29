#!/bin/sh
# Keeps the disk from filling during long unattended runs. Recordings older
# than eight hours, trial logs older than three hours (gzipped, the audit
# reads .log.gz), and nothing else. Run every 20 minutes.
cd "$(dirname "$0")/../.." || exit 1
find .clean-run*/recordings -type f -mmin +480 -delete 2>/dev/null
find .clean-run*/recordings -mindepth 3 -type d -empty -delete 2>/dev/null
find artifacts -maxdepth 1 -name 'midgame-*.log' -mmin +180 -size +1M -exec gzip -f {} \; 2>/dev/null
free=$(df -g /System/Volumes/Data | awk 'NR==2{print $4}')
echo "$(date -u +%FT%TZ) free ${free}G"
if [ "$free" -lt 12 ]; then
  find .clean-run*/recordings -type f -mmin +120 -delete 2>/dev/null
  echo "low disk: recordings older than 2h removed"
fi
