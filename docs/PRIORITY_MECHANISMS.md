# Can a satellite send one piece of data ahead of its queue? What exists today

Research note, 6 November 2026. Question: is there any mechanism on real satellites by which a small, urgent
message bypasses the recorder backlog and the next-pass wait? Answer: yes, five distinct ones, at different
layers. Each is listed with what it does, who uses it, the latency it achieves, and whether the simulator models it.

## 1. Priority inside the recorder: the playback queue is not strictly FIFO

Sentinel-2's mass memory lets the operator mark acquisitions as Near-Real-Time so they go to the **head of the
playback queue** instead of the nominal first-in-first-out order, and it can command a **Real-Time downlink**
that forwards the 490 Mbit/s instrument stream straight to the transmitter while it is being acquired
[Sentinel-2 User Handbook]. Sentinel-1 has the same three tiers: real-time pass-through (acquire and downlink
simultaneously, used over European waters together with AIS), near-real-time within one orbit, and standard
within two orbits [Sentinel-1 System Overview; User Handbook]. Landsat 8 transmits **real-time and playback
files at the same time** on separate virtual channels of the one X-band carrier [eoPortal Landsat-8].

The generic standard behind this is ECSS PUS Service 15 (on-board storage and retrieval), which exists precisely
to let the ground "retrieve packets of high operational significance with high priority" [ECSS-E-ST-70-41C].

*Limit:* the message still needs a pass over a station; priority only decides what goes first once contact
exists. *Simulator:* the "priority" toggle (backlog set to zero).

## 2. Priority on the link: CCSDS virtual channels

Every CCSDS downlink (TM or AOS frames) is split into **virtual channels**, each carrying data "with different
priority and latency requirements"; the multiplexer on board decides which VC's frame goes next, and an absolute-
priority scheduler lets a high-priority VC pre-empt the others completely [CCSDS 130.2-G; CCSDS 350.5-G;
Yamcs VC scheduling]. Housekeeping telemetry is normally VC0 and is always serviced first; a semantic alert
belongs on such a channel. *Limit:* same as above, needs contact. *Simulator:* the S-band TT&C route treats the
message as telemetry (no backlog, no payload transmitter time).

## 3. Priority in the network: DTN bundle classes

Where data crosses several hops (relay satellites, store-carry-forward), the Bundle Protocol used by NASA/ESA
DTN defines three classes, **Expedited > Normal > Bulk**; nodes sort their queues by class then by creation
time [RFC 4838; Bundle Protocol Extended Class of Service]. This is the formal version of "the alert jumps the
queue at every node", and it is what a tip-and-cue constellation uses to move a tip to the cueing satellite
[ESA Φ-lab AI tip-and-cue; SpaceNews tip-and-cue]. *Simulator:* not modelled (single hop).

## 4. An always-on channel that does not wait for a pass

This is the only class that removes the waiting term.

| system | what it gives the satellite | achieved latency | who uses it |
|---|---|---|---|
| EDRS / SpaceDataHighway (GEO laser relay) | continuous 1.8 Gbit/s link whenever the LEO satellite sees EDRS-A (9°E) or EDRS-C (31°E) | data on the ground **within minutes** of acquisition instead of the next pass; 9–12 links per satellite per day | Sentinel-1A/B, Sentinel-2A/B [ESA EDRS; ESA Sentinel-2 operations] |
| NASA TDRS Demand Access System | a **dedicated beamformer per user, 24 h/day, no scheduling**, for low-rate return data | continuous; science and alert data any time | Swift, Fermi GBM burst alerts (seconds to the GCN network), Terra/Aqua science return [NASA SN DAS, AIAA 2002] |
| Iridium short-burst data (SBD) modem on the satellite | one-way or two-way messages of up to 1,960 bytes through the 66-satellite Iridium constellation, global | **5 s (70 B) to ~20 s (max length)** measured delivery; HERMES CubeSats send gamma-ray burst alerts "within minutes" this way | HERMES-TP/SP, many CubeSats [Iridium SBD; HERMES PDHU paper] |
| BeiDou short-message service | ~ 1 kbit messages through the BeiDou navigation satellites | GECAM burst alerts reach the ground **~1 minute** after trigger | GECAM [GECAM real-time burst alert system] |
| Globalstar simplex | one-way small packets, near-global, from CubeSats | continuous telemetry when in Globalstar coverage | USNA CubeSats, NSL EyeStar-S3 [USNA Globalstar CubeSat; NSL SSC16] |
| Inmarsat L-band (Addvalue IDRS) | two-way link through GEO Inmarsat for commands and small data, 24/7 | tasking uplink **within minutes instead of 4–8 h**; the same channel can carry small downlink messages | Capella Space [Via Satellite 2019; SpaceNews 2020] |
| Kepler Aether optical relay (LEO) | laser inter-satellite links to a relay constellation, then optical to ground; marketed for "real-time delivery of imagery and analytics" | commercial service started 2026 | early customers; Starlink laser terminals are also being sold to third parties [SpaceQ; Kepler] |

*Simulator:* GEO relay (EDRS/TDRS/JDRS) with geometric line of sight; and a new route "LEO short-message
relay" using the Iridium SBD figures (5–20 s per message, 1,960 B per message), available to any satellite that
carries such a modem (labelled hypothetical for satellites that do not).

## 5. Tip and cue: send the alert to another satellite, not to the ground first

Operators increasingly let one satellite's on-board detection generate a **tip** (region, time, priority) that is
relayed to a second, higher-resolution satellite as a **cue**, shortening tip-to-cue time to minutes
[ESA Φ-lab; Tip-and-cue scheduling, Acta Astronautica 2026; SpaceNews]. The tip is a semantic message by
construction: a few hundred bytes describing where to look, which is exactly the frog link's output format.

## What this means for the frog link

1. The mechanisms exist and are standard; nothing new has to be invented on the protocol side. A frog alert can
   be (a) marked NRT and put at the head of the recorder queue, (b) placed on the housekeeping virtual channel,
   and (c) handed to an always-on low-rate channel (EDRS share, TDRS DAS, Iridium SBD, BeiDou, Inmarsat).
2. Only (c) removes the pass wait. Its cost is a second radio or a relay subscription, and a per-message budget
   of a few hundred to a few thousand bytes. That budget is far too small for imagery and exactly right for the
   frog fibres (20–40 bytes per frame, 6 kB for a five-minute observation).
3. The achievable end-to-end numbers today: seconds (TDRS DAS, Fermi alerts), 5–20 s (Iridium SBD), ~1 min
   (BeiDou), minutes (EDRS). The simulator's route table shows these next to the X-band queue.

## Sources

- Sentinel-2 User Handbook (NRT priority in the playback queue, RT downlink of the 490 Mbit/s stream) — https://sentinels.copernicus.eu/documents/247904/685211/Sentinel-2_User_Handbook
- ESA Sentinel-1 System Overview; Sentinel-1 User Handbook (RT pass-through, NRT 1 orbit, standard 2 orbits) — https://pdfs.semanticscholar.org/9875/9531c91e6b1a2fccfef7202e2ab5e07f4a76.pdf ; https://ftp.itc.nl/pub/Dragon4_Lecturer_2018/ESA%20EEs%20and%20Sentinels%20Brochures%20pdf/Copernicus%20Sentinels%201,2,3/Sentinel-1%20User%20Handbook.pdf
- eoPortal Landsat-8 (simultaneous real-time and playback on virtual channels) — https://www.eoportal.org/satellite-missions/landsat-8-ldcm
- ECSS-E-ST-70-41C, PUS Service 15 on-board storage and retrieval — https://ecss.nl/wp-content/uploads/2024/12/ECSS-E-ST-70-41C-Rev.1-DIR1(11December2024).pdf
- CCSDS 130.2-G Space Data Link Protocols summary (virtual channels, priority) — http://mtc-m16c.sid.inpe.br/col/sid.inpe.br/mtc-m18@80/2009/07.16.12.14/doc/CCSDS%20130.2-G-1.pdf ; CCSDS 350.5-G — https://ccsds.org/Pubs/350x5g2.pdf ; Yamcs VC scheduling — https://docs.yamcs.org/yamcs-server-manual/links/ccsds-frame-processing/
- RFC 4838 DTN architecture; Bundle Protocol ECOS (expedited/normal/bulk) — https://www.rfc-editor.org/rfc/rfc4838.html ; https://datatracker.ietf.org/doc/html/draft-irtf-dtnrg-ecos-03
- ESA EDRS (minutes instead of next pass; Sentinel-1/2 operational users) — https://resilience.esa.int/archives/partnership-projects/european-data-relay-system-edrs ; ESA Sentinel-2 operations (9–12 links/day) — https://www.esa.int/Enabling_Support/Operations/Sentinel-2_operations
- NASA Space Network Demand Access System (24 h unscheduled low-rate return) — https://arc.aiaa.org/doi/pdf/10.2514/6.2002-T2-50 ; https://gsaw.org/wp-content/uploads/2015/03/2015s06hogie.pdf
- Iridium SBD (5–20 s delivery, message sizes) — https://gtc.co.uk/pages/iridium-short-burst-data ; https://www.groundcontrol.com/products/iridium/short-burst-data-range
- HERMES PDHU (burst alerts via Iridium) — https://arxiv.org/pdf/2101.03947
- GECAM real-time burst alert via BeiDou (~1 min) — https://arxiv.org/abs/2307.04999
- Globalstar simplex on CubeSats — https://www.usna.edu/AeroDept/_files/AY19_Perfect_Integration_of_Globalstar_System_in_Cubesats.pdf ; https://digitalcommons.usu.edu/cgi/viewcontent.cgi?article=3300&context=smallsat
- Capella / Addvalue / Inmarsat real-time tasking (minutes vs 4–8 h) — https://www.satellitetoday.com/imagery-and-sensing/2019/08/05/capella-space-addvalue-inmarsat-partner-for-real-time-tasking/
- Kepler Aether optical relay — https://spaceq.ca/kepler-communications-high-speed-optical-data-relay-satellites-successfully-launched/ ; https://kepler.space/
- Tip and cue — https://cin.philab.esa.int/databases/projects/laying-the-foundation-for-ai-based-tip-and-cue ; https://spacenews.com/how-earth-observation-satellite-operators-are-teaming-up-to-tip-and-cue-one-another/ ; https://www.sciencedirect.com/science/article/abs/pii/S0094576526002936
