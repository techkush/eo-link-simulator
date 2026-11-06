# How much data is waiting in Sentinel-2's recorder? What is knowable, and how the simulator estimates it

Research note, 6 November 2026.

## What is not public

The fill level of the on-board mass memory (MMFU) is housekeeping telemetry. ESA's flight operations team at ESOC
sees it on every S-band pass; it is not published. Neither is the daily downlink schedule (which pass dumps what).
Mission status reports (weekly, on Sentinel Online) give aggregate figures only.

## What is public, and enough to estimate it

1. **The acquisition plan.** ESA publishes every planned datatake for Sentinel-2A/B/C 10–18 days ahead, as KML,
   updated weekly: https://sentinels.copernicus.eu/copernicus/sentinel-2/acquisition-plans. Each datatake has
   `ObservationTimeStart`, `ObservationTimeStop`, `ObservationDuration` (ms), `Scenes`, `Mode` (NOBS nominal,
   VIC vicarious, DARK-O, SUN), orbit numbers, and a timeliness style (`NOBS_NOMINAL` or `NOBS_NRT`). The current
   Sentinel-2A file (`s2a_mp_acq__kml_20261029t150000_20261116t180000`) holds 318 datatakes: a mean of 126
   observation minutes and 17 datatakes per day, mean 7.2 min, maximum 30.2 min, 0.28 scenes per second.
   Sentinel-2B and 2C are tasked three times harder (about 1,000 datatakes per 18 days).
2. **The instrument rate after compression**: 490 Mbit/s (raw 1.4 Gbit/s, wavelet ratio 2.4–3) [ESA/Airbus
   MSI papers, SPIE 8889]. So 126 min/day of imaging is 3.7 Tbit = 463 GB/day for Sentinel-2A at present.
3. **The playback rate** 560 Mbit/s on X-band, the **memory size** 2.4 Tbit (300 GB) [eoPortal], the **core
   X-band stations** Matera, Maspalomas, Svalbard and Inuvik [Copernicus core ground segment; ESA data flow],
   and **EDRS** at 1.8 Gbit/s whenever EDRS-A (9°E) or EDRS-C (31°E) is in line of sight, 9–12 links per day
   [ESA Sentinel-2 operations].

## The estimate

queue(t) = Σ (datatake seconds up to t) × 490 Mbit/s − Σ (service), with service at 560 Mbit/s during predicted
passes over the four core stations (SGP4, 5° mask) and 1.8 Gbit/s during EDRS line of sight, capped at 25 min of
EDRS per orbit; the queue is clamped to the 2.4 Tbit memory. The simulation runs from 48 h before the displayed
window so the warm-up does not matter, and is re-evaluated every minute against the simulation clock.

For Sentinel-2A on 6 November 2026 at 20:27 UTC the estimate was: recorder empty now, 468 GB acquired in the
previous 24 h, peak 23 GB (one 10-minute datatake), next datatake 00:51 UTC. That is, with 4 core stations plus
EDRS and 126 min of imaging per day, Sentinel-2A drains each datatake within one orbit; a message created on
Sentinel-2A rarely waits behind imagery. Sentinel-2B/C, with three times the imaging, show the longer queues.

## Caveats

- Service is modelled, not the operator's real schedule: the real system books specific passes and EDRS links,
  and other Sentinels share the same stations. The estimate is therefore the *best case* for the queue.
- The acquisition plan is the plan; unplanned datatakes (emergency tasking) and cancelled ones are not reflected.
- Priority (NRT) datatakes jump the queue in reality; the model is FIFO unless "priority" is on.
- Only Sentinel-2 publishes plans in this form. Sentinel-1 publishes similar KML plans; Landsat publishes the daily
  acquisition calendar; commercial operators publish nothing. For those, the simulator uses the mission's daily
  volume divided by 16 as the default backlog (about 1.5 h of acquisition).

## Sources

- Sentinel-2 acquisition plans — https://sentinels.copernicus.eu/copernicus/sentinel-2/acquisition-plans
- MSI data rate after compression 490 Mbit/s, wavelet 2.4–3 — https://astronomicaltelescopes.spiedigitallibrary.org/conference-proceedings-of-spie/8889/88890L/Sentinel-2--next-generation-satellites-for-optical-land-observation/10.1117/12.2028725.full
- eoPortal Sentinel-2 (2.4 Tbit memory, 560 Mbit/s X-band) — https://www.eoportal.org/satellite-missions/copernicus-sentinel-2
- Copernicus core ground segment; ESA Sentinel-2 data flow; Inuvik contingency note — https://sentinel.esa.int/web/sentinel/missions/sentinel-2/ground-segment/core-ground-segment ; https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-2/Data_flow ; https://dataspace.copernicus.eu/node/669
- ESA Sentinel-2 operations (EDRS 9–12 links/day) — https://www.esa.int/Enabling_Support/Operations/Sentinel-2_operations
