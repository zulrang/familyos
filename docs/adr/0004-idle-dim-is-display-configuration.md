# Idle Dim is Display Configuration and dims the panel

Idle Dim belongs on the Trusted Display, not in Household Configuration — timeout
and dim brightness are physical to that panel, the same way Display size already
is. The web app does not dim itself; the FullPageOS idle-dim process lowers the
panel backlight over DDC. One timeout and one brightness apply per Display; both
HDMI ports on the reference Pi 5 are bus discovery, not two settings. Dim-to is
a discrete menu (1 / 10 / 20 / 30 / 40 / 50 / 60 / 70 / 80 percent) so it matches
Display size at kitchen distance; 1% is the floor so idle never looks like the
panel powered off (DPMS stays off).

Household-wide values would let one wall clobber another. A CSS overlay would
be easier and would not lower the panel.
