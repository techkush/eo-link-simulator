# Why satellite data takes hours to arrive, and what a semantic payload changes

Research note, 6 November 2026, for the EO link simulator. Every number below is tied to a source; where a number
is an inference from sources it is marked *derived*.

## 1. The radio is not the bottleneck; the queue and the geometry are

A pass over one station lasts 7–10 minutes and a satellite gets four to six such windows a day with any one
station [Planet engineers, cited in forcedfutures "The Downlink Wall"; ICEYE "Moving data at maximum speed"].
An LEO orbit is ~95–100 minutes, so a satellite has roughly 10 minutes of ground contact per 100 minutes of
flight [ESA "Downlink delay"]. Everything sensed between windows is stored on board and played back later:
measured store-and-forward delays range from tens of seconds to nearly 5 hours [arXiv 2409.00897, EO constellation
delay study], and operators describe backlogs of "a few hours to several days" when downlink capacity is short.

Data volume makes the queue long. A modern imaging satellite collects 500 GB to 1 TB per day [TerraWatch Space via
"The Downlink Wall"]. Sentinel-2 collects 1.5 TB/day after on-board compression into a 2.4 Tbit mass memory and
plays it back at 560 Mbit/s [eoPortal Sentinel-2]. *Derived*: one 10-minute X-band pass moves 560 Mbit/s × 600 s =
336 Gbit = 42 GB, so draining 1.5 TB/day needs ~36 pass-equivalents per day, which is why Sentinel-2 uses three
core X-band stations (Matera, Maspalomas, Svalbard) plus 9–12 EDRS laser-relay links per day [ESA Sentinel-2
operations; Copernicus core ground segment]. Landsat 8/9 acquires up to 740 scenes/day into a 3.1–4 TB recorder
and delivers an average of 400 scenes/day over its 440 Msym/s X-band link to Sioux Falls, Fairbanks and Svalbard
[USGS LDCM mission data architecture; eoPortal Landsat-9]. Ground networks are themselves near capacity: ESA
counts more than 40,000 downlink passes a day across European networks [ESA AFFRESCO, via "The Downlink Wall"].

## 2. Duty-cycle limits on the satellite

The instrument and the transmitter are both duty-cycle limited by power and heat. Sentinel-1's SAR may image at
most 25 minutes per orbit; its X-band downlink is capped at 30 minutes per orbit and 20 minutes consecutive, and
the number of X-band RF switches per orbit is itself a constraint [ESA Sentinel-1 System Overview; Sentinel-1
User Handbook]. Conventional SAR amplifiers run at ~10 % duty, GaN modules up to ~25 % with careful thermal design
[SmallSat conference, X-band SAR engineering model]. Phased-array transmitters on small satellites are explicitly
limited in duty cycle and output power by heat [AIAA/USU SmallSat papers]. A CubeSat's orbit-average power is
7–18 W [USU SmallSat], so a 10 W X-band transmitter cannot be left on.

Consequence: even when a station is in view, the satellite may not be allowed to transmit, and the operator
schedules which passes to use. The semantic message changes this directly: a few hundred bits need a transmitter
on for microseconds, or none at all if they ride the always-on S-band telemetry channel.

## 3. Latency as the operators quote it

| mission / operator | quoted latency | where it comes from | source |
|---|---|---|---|
| Sentinel-1 | RT 10 min (European waters); NRT 1 h (emergency, subscription) / 3 h (NRT areas); standard 24 h | on-board latency allowed up to 200 min (2 orbits); 1 orbit for NRT; simultaneous acquire-and-downlink for RT | ESA Sentinel-1 System Overview, User Handbook, Sentinel-1 mission status |
| Sentinel-2 | products 3–24 h after sensing; "priority schemes ... shortest possible latency" for critical data | X-band to three core stations + EDRS; processing to L1C/L2A | sentiwiki S2 Mission; ESA Sentinel-2 operations |
| Landsat 8/9 | ~5 h average from acquisition to product; scenes searchable within 6 h | playback to 3 LGN stations, then L1 processing | USGS Landsat 8/9 handbook; USGS data availability |
| Planet (PlanetScope) | 2–4 h request to delivered image | store-and-forward over a large ground network | eoPortal, via "The Downlink Wall" |
| ICEYE | ~15 min from acquisition to preliminary product when the raw stream is processed at the station | streaming SAR data straight into the processor, no store-and-forward | ICEYE "Latency: the ability to act" |
| Capella | imagery downlinked on the next pass over a ground station after collection | automatic scheduler + AWS Ground Station | SpaceNews satellite tasking |
| VIIRS fires (FIRMS) | < 3 h global; < 60 s "ultra real-time" over the US/Canada | global: stored data dumped at Svalbard/McMurdo then processed; URT: X-band direct broadcast received by a local antenna under the pass | NASA Earthdata FIRMS URT |
| L2D2 research system | median 90 min → 21 min | many cheap receive-only ground stations instead of a few full stations | L2D2, SIGCOMM 2021 |
| On-board AI (Φ-Sat-1) | — | discarding cloudy tiles on board cut downlink volume by ~90 % | ESA Φ-Sat-1 |

Three patterns are visible. (i) The minimum delay is set by the next contact, 20–100 minutes for a global
network, unless the satellite can transmit while it senses (ICEYE streaming, VIIRS direct broadcast). (ii) The
typical delay is set by the backlog ahead of your data in the recorder plus the processing chain: hours. (iii)
Priority schemes exist precisely because operators cannot drain the queue; critical data gets a head-of-queue
slot and a dedicated pass.

## 4. What the semantic (frog) link changes, and what it does not

**Removes.** The backlog term: a 64–321-bit message is not queued behind 42 GB of imagery; it fits in one CCSDS
frame (1,115 bytes) and can be sent at the start of any pass, or interleaved in the S-band housekeeping telemetry
that every station in the network can receive (S-band is on 44 of the 45 stations in the simulator; X-band on 39).
The duty-cycle term: no X-band transmitter time is consumed; power is the receptors and the SNN, 0.03 µJ per frame
in our model. The processing term: there is no image to process, the message is the product (level B/C).
On a GEO relay share of a few kbit/s the message arrives in ~0.3 s whenever the relay is in view, which for
EDRS is roughly half of every orbit for a European-visible arc.

**Does not remove.** The geometry: without a relay or an always-on low-rate constellation link, the message
still waits for the next contact. For a single station this is the dominant term (hours); for a global S-band
network it is tens of minutes. This is the argument for pairing the semantic front end with an always-on
low-rate channel (GEO relay share, LEO IoT/ISL, or Iridium-class short-burst data) rather than with the X-band
payload link at all.

**What the simulator now models.** (1) An on-board backlog ahead of the message in the recorder, defaulting to
the mission's daily volume scaled by the time since the last pass, drained FIFO at the payload rate, or bypassed
when "priority" is on; (2) the X-band duty-cycle cap per orbit, which limits how much of a pass can be used;
(3) a fourth route: the message on the S-band TT&C channel through every S-band station of the chosen network;
(4) ground processing presets: forward raw (0 s), NRT product (1 h), standard product (24 h).

## Sources

- forcedfutures, "The Downlink Wall: Why Satellites Throw Away Data" (TerraWatch Space, Planet engineers, ESA AFFRESCO, eoPortal figures) — https://forcedfutures.substack.com/p/the-pipe
- eoPortal, Copernicus Sentinel-2 (1.5 TB/day, 2.4 Tbit, 560 Mbit/s) — https://www.eoportal.org/satellite-missions/copernicus-sentinel-2
- ESA, Sentinel-2 operations (9–12 EDRS links/day) — https://www.esa.int/Enabling_Support/Operations/Sentinel-2_operations
- Copernicus Sentinel-2 Core Ground Segment (Matera, Maspalomas, Svalbard) — https://sentinel.esa.int/web/sentinel/missions/sentinel-2/ground-segment/core-ground-segment
- sentiwiki, S2 Mission (3–24 h, priority schemes) — https://sentiwiki.copernicus.eu/web/s2-mission
- ESA, Sentinel-1 System Overview (25 min SAR, 30 min X-band per orbit, 200 min on-board latency) — https://pdfs.semanticscholar.org/9875/9531c91e6b1a2fccfef7202e2ab5e07f4a76.pdf
- ESA, Sentinel-1 User Handbook (RT / NRT / 24 h timeliness) — https://ftp.itc.nl/pub/Dragon4_Lecturer_2018/ESA%20EEs%20and%20Sentinels%20Brochures%20pdf/Copernicus%20Sentinels%201,2,3/Sentinel-1%20User%20Handbook.pdf
- USGS, LDCM space-to-ground mission data architecture (440 Msym/s, 400 scenes/day, LGN) — https://pubs.usgs.gov/publication/70007275
- eoPortal, Landsat-9 (740 scenes/day, 3.1–4 TB SSR, 4–6 h) — https://www.eoportal.org/satellite-missions/landsat-9
- USGS, Landsat 8 Data Users Handbook (latency ~5 h) — https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/atoms/files/LSDS-1574_L8_Data_Users_Handbook-v5.0.pdf
- ICEYE, "Beyond the Echo: Latency" and "Moving data at maximum speed" — https://www.iceye.com/blog/beyond-the-echo-the-ability-to-act ; https://www.iceye.com/blog/beyond-the-echo-moving-data-at-maximum-speed
- SpaceNews, "Earth imagery companies reimagine satellite tasking" (Capella) — https://spacenews.com/satellite-tasking/
- NASA Earthdata, FIRMS ultra real-time data (< 60 s direct broadcast; < 3 h global) — https://www.earthdata.nasa.gov/learn/articles/firms-urt-data
- Vasisht et al., L2D2: Low Latency Distributed Downlink, SIGCOMM 2021 (90 → 21 min) — https://conferences.sigcomm.org/sigcomm/2021/files/papers/3452296.3472932.pdf
- arXiv 2409.00897, Data delay and overflow in EO constellations (tens of seconds to ~5 h) — https://arxiv.org/abs/2409.00897
- ESA, "Downlink delay" (10 minutes of contact per 100-minute orbit) — https://www.esa.int/ESA_Multimedia/Images/2015/06/Downlink_delay
- ESA / eoPortal, Φ-Sat-1 (on-board cloud detection, ~90 % downlink reduction) — https://www.eoportal.org/satellite-missions/phisat-1
- USU SmallSat, X-band SAR engineering model (10 % / 25 % duty) and small-satellite power (7–18 W) — https://digitalcommons.usu.edu/smallsat/
