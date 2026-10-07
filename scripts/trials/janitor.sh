#!/bin/sh
# Keeps the disk from filling during long unattended runs. Recordings older
# than eight hours, trial logs older than three hours (gzipped, the audit
# reads .log.gz), and nothing else. Run every 20 minutes.
cd "$(dirname "$0")/../.." || exit 1
find .clean-run*/recordings -type f -mmin +480 -delete 2>/dev/null
find .clean-run*/recordings -mindepth 3 -type d -empty -delete 2>/dev/null
find artifacts -maxdepth 1 -name 'midgame-*.log' -mmin +180 -size +1M -exec gzip -f {} \; 2>/dev/null
# A live trial's log over 500 MB: its lines so far gzipped beside it and the
# log emptied in place (note 1338). The trial holds it open for appending, so
# its next line goes on at the start; nothing written is lost. 2026-10-06
# 01:15Z the disk was down to 1 GB free with 8 GB in live logs, 25589's
# growing 95 KB a second (a pass repeated fifteen times a second).
for f in $(find artifacts -maxdepth 1 -name 'midgame-*.log' -mmin -180 -size +500M 2>/dev/null); do
  part="${f%.log}.part-$(date -u +%Y%m%dT%H%M%SZ).log.gz"
  gzip -c "$f" > "$part" && : > "$f" && echo "$f gzipped to $part"
done
free=$(df -g /System/Volumes/Data | awk 'NR==2{print $4}')
echo "$(date -u +%FT%TZ) free ${free}G"
if [ "$free" -lt 12 ]; then
  find .clean-run*/recordings -type f -mmin +120 -delete 2>/dev/null
  echo "low disk: recordings older than 2h removed"
fi
# The record of options Jev found missing, the same way past 300 MB (note
# 1355): every bot appends a line at each none good, 903 MB on 2026-10-06.
m=artifacts/missing-options.jsonl
if [ -n "$(find $m -size +300M 2>/dev/null)" ]; then
  gzip -c "$m" > "artifacts/missing-options.part-$(date -u +%Y%m%dT%H%M%SZ).jsonl.gz" && : > "$m" && echo "$m gzipped"
fi
# Checkpoint rings of worlds no server runs, past twelve hours (note 1348):
# a ring is for starting a running trial's moment again; 600 ended ones held
# 15 GB on 2026-10-06.
running=$(for d in .clean-run .clean-run-*; do sed -n 's/^level-name=//p' "$d/server.properties" 2>/dev/null; done)
# Only the worlds' own rings (mid-*): the stage saves (stages/) and the deaths
# are kept (note 1398: this took stages/ with it, and every stage start since
# 2026-10-06 found "no snapshots").
for w in $(find .trial-checkpoints -maxdepth 1 -mindepth 1 -type d -name 'mid-*' -mmin +720 -exec basename {} \; 2>/dev/null); do
  echo "$running" | grep -qx "$w" || rm -rf ".trial-checkpoints/$w"
done
# Each trial server records about 8 MB a minute (2026-10-06): two hours of
# recordings is some 12 GB, so under 6 GB free only the last hour is kept.
if [ "$free" -lt 6 ]; then
  find .clean-run*/recordings -type f -mmin +60 -delete 2>/dev/null
  echo "very low disk: recordings older than 1h removed"
fi
