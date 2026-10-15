# Node toolchain runs in a pinned hardened image — never on the host.
#
# The repo is bind-mounted at /work and every target runs inside the container,
# so Docker is the only thing a machine needs. Targets that do not need the
# network run under --network=none.
IMAGE := dhi.io/node:24-debian13-sfw-dev
APP   := $(CURDIR)
UID   := $(shell id -u)
GID   := $(shell id -g)

# Dev server. Loopback by default; exposing it is a deliberate act.
#   make dev PORT=9000 BIND=0.0.0.0
PORT ?= 4321
BIND ?= 127.0.0.1

# --init so Ctrl-C reaches node (it would be PID 1 otherwise), and a named
# container torn down from a trap, because killing the docker CLI does not kill
# the container. $$$$ is the recipe shell's PID so parallel runs don't collide.
CNAME = govargus-$@-$$$$
TRAP  = name=$(CNAME); trap "docker rm -f $$name >/dev/null 2>&1; exit 130" INT TERM;
ENV   = -e HOME=/tmp -e ASTRO_TELEMETRY_DISABLED=1
RUN     = $(TRAP) docker run --rm --init --name $$name -v "$(APP):/work" -w /work -u $(UID):$(GID) $(ENV) $(IMAGE)
RUN_KEYED = $(TRAP) docker run --rm --init --name $$name -v "$(APP):/work" -w /work -u $(UID):$(GID) $(ENV) -e CONGRESS_API_KEY $(IMAGE)
RUN_OFF = $(TRAP) docker run --rm --init --name $$name -v "$(APP):/work" -w /work -u $(UID):$(GID) $(ENV) --network=none $(IMAGE)

.PHONY: all install data policy build check dev preview clean

all: check build

# Needs the network.
install:
	$(RUN) npm install

# Pulls every indicator from its source into src/data/series/. Needs the network.
data:
	$(RUN) node scripts/fetch-data.mjs

# Executive orders (Federal Register) and public laws (Congress.gov) into
# src/data/policy/. Needs the network. Set CONGRESS_API_KEY (free, from
# https://api.data.gov/signup/) or it falls back to the 10-requests/hour DEMO_KEY.
policy:
	$(RUN_KEYED) node scripts/fetch-policy.mjs

# Offline. Call binaries directly, NOT `npm run`: the image's Socket Firewall
# shims npm and, under --network=none, fails open and exits 0 without running.
build:
	$(RUN_OFF) npx astro build

# Validates the hand-curated data files (presidents, events, indicators).
check:
	$(RUN_OFF) node scripts/check-data.mjs

# Publishing a port needs a network namespace, so these can't use --network=none.
dev:
	@echo "  http://$(BIND):$(PORT)"
	$(TRAP) docker run --rm --init -it --name $$name -v "$(APP):/work" -w /work -u $(UID):$(GID) $(ENV) \
		-p $(BIND):$(PORT):$(PORT) $(IMAGE) npx astro dev --host 0.0.0.0 --port $(PORT)

preview:
	@echo "  http://$(BIND):$(PORT)"
	$(TRAP) docker run --rm --init -it --name $$name -v "$(APP):/work" -w /work -u $(UID):$(GID) $(ENV) \
		-p $(BIND):$(PORT):$(PORT) $(IMAGE) npx astro preview --host 0.0.0.0 --port $(PORT)

clean:
	rm -rf dist .astro
