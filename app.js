const allStopsContainer = document.getElementById('all-stops');
let originInput = allStopsContainer.querySelector('.stop-row:first-child input');
let destinationInput = allStopsContainer.querySelector('.stop-row:last-child input');
const departureDateInput = document.getElementById('departure-date');
const departureTimeInput = document.getElementById('departure-time');
const planButton = document.getElementById('plan-trip');
const errorMessage = document.getElementById('error-message');
const weatherTimeline = document.getElementById('weather-timeline');
const timelineCards = document.getElementById('timeline-cards');
const weatherChart = document.getElementById('weather-chart');
const routesSection = document.getElementById('routes-section');
const routesList = document.getElementById('routes-list');
const myLocationBtn = document.getElementById('my-location-btn');
const swapBtn = document.getElementById('swap-btn');
const addWaypointBtn = document.getElementById('add-waypoint-btn');
const directionsPanel = document.getElementById('directions-panel');
const recentSearchesDiv = document.getElementById('recent-searches');
const recentList = document.getElementById('recent-list');
const shareTripBtn = document.getElementById('share-trip-btn');
const printTripBtn = document.getElementById('print-trip-btn');
const departureSlider = document.getElementById('departure-slider');
const sliderTimeLabel = document.getElementById('slider-time-label');
const goNowBtn = document.getElementById('go-now-btn');
const pickTimeBtn = document.getElementById('pick-time-btn');
const pickTimeSection = document.getElementById('pick-time-section');
const tripActions = document.getElementById('trip-actions');
const bestTimeBtn = document.getElementById('best-time-btn');
const bestTimeResult = document.getElementById('best-time-result');
const startNavBtn = document.getElementById('start-nav-btn');
const navOverlay = document.getElementById('nav-overlay');

let map = null;
let directionsRenderers = [];
let weatherOverlays = [];
let routeInfoOverlays = [];
let radarLayer = null;
let radarRefreshInterval = null;
let WeatherOverlay = null;
let RouteInfoOverlay = null;
let lastRouteBounds = null;
let currentWeatherData = null;
let currentRouteData = null;
let currentDirectionsResult = null;
let pickTargetInput = null;
let pickMarker = null;
let myLocationMarker = null;
let waypointInputs = [];
let useGoNow = true;
let travelMode = 'DRIVING';

// Navigation state
let navActive = false;
let navWatchId = null;
let navRoute = null;
let navSteps = [];
let navCurrentStep = 0;
let navMarker = null;
let navRenderer = null;
let navFollowing = true;
let navTotalDist = 0;
let navStartTime = null;
let navWakeLock = null;
let navWeatherInterval = null;
let navAlertTimeout = null;
let navLastAlertStep = -1;
let navLastHeading = 0;
let navUserDragged = false;
let navRadarWasOn = false;
let navMuted = false;
let navWeatherAlertTimeout = null;
let navAudioCtx = null;

const now = new Date();
departureDateInput.value = now.toISOString().split('T')[0];
departureDateInput.min = now.toISOString().split('T')[0];
departureTimeInput.value = now.toTimeString().slice(0, 5);
departureSlider.value = now.getHours();
const _h = now.getHours(), _ampm = _h < 12 ? 'AM' : 'PM', _h12 = _h === 0 ? 12 : _h > 12 ? _h - 12 : _h;
sliderTimeLabel.textContent = `${_h12}:00 ${_ampm}`;

loadRecentSearches();

function updateClearButtons() {
    const rows = allStopsContainer.querySelectorAll('.stop-row');
    const showRemove = rows.length >= 3;
    rows.forEach(row => {
        const btn = row.querySelector('.stop-remove-btn');
        if (btn) btn.classList.toggle('hidden', !showRemove);
    });
}

function updateStopReferences() {
    const inputs = [...allStopsContainer.querySelectorAll('.stop-row input')];
    originInput = inputs[0];
    destinationInput = inputs[inputs.length - 1];
    waypointInputs = inputs.slice(1, -1);
    updateStopIndicators();
    updateClearButtons();
}

function updateStopIndicators() {
    const rows = [...allStopsContainer.querySelectorAll('.stop-row')];
    rows.forEach((row, i) => {
        const dot = row.querySelector('.stop-dot');
        const existingLine = row.querySelector('.dot-line');
        if (dot) {
            const color = i === 0 ? '#5f6368' : i === rows.length - 1 ? '#4285f4' : '#fbbc04';
            dot.style.background = color;
            dot.style.borderColor = color;
        }
        if (i > 0 && !existingLine) {
            const wrap = row.querySelector('.input-dot-wrap');
            if (wrap) { const line = document.createElement('span'); line.className = 'dot-line'; wrap.appendChild(line); }
        } else if (i === 0 && existingLine) {
            existingLine.remove();
        }
        const input = row.querySelector('input');
        if (i === 0) input.placeholder = 'Starting point or click on map';
        else if (i === rows.length - 1) input.placeholder = 'Destination or click on map';
        else input.placeholder = 'Add a stop...';
    });
}

function attachStopDrag(row) {
    row.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging-row');
        setTimeout(() => row.style.opacity = '0.4', 0);
    });
    row.addEventListener('dragend', () => {
        row.style.opacity = '1';
        row.classList.remove('dragging-row');
        allStopsContainer.querySelectorAll('.stop-row').forEach(r => r.classList.remove('drag-over'));
        updateStopReferences();
    });
    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dragging = allStopsContainer.querySelector('.dragging-row');
        if (dragging && dragging !== row) {
            allStopsContainer.querySelectorAll('.stop-row').forEach(r => r.classList.remove('drag-over'));
            row.classList.add('drag-over');
            const rect = row.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (e.clientY < mid) allStopsContainer.insertBefore(dragging, row);
            else allStopsContainer.insertBefore(dragging, row.nextSibling);
        }
    });
}

function setPickMode(inputEl) {
    pickTargetInput = inputEl;
    map.setOptions({ draggableCursor: 'crosshair' });
    document.querySelectorAll('.picking').forEach(el => el.classList.remove('picking'));
    inputEl.classList.add('picking');
}

function initApp() {
    WeatherOverlay = class extends google.maps.OverlayView {
        constructor(position, content, mapInstance) {
            super();
            this.position = position;
            this.content = content;
            this.div = null;
            this.setMap(mapInstance);
        }
        onAdd() {
            this.div = document.createElement('div');
            this.div.innerHTML = this.content;
            this.div.style.position = 'absolute';
            this.div.style.zIndex = '1';
            const detail = this.div.querySelector('.overlay-detail');
            this.div.addEventListener('mouseenter', () => {
                this.div.style.zIndex = '9999';
                if (detail) detail.style.display = 'block';
            });
            this.div.addEventListener('mouseleave', () => {
                this.div.style.zIndex = '1';
                if (detail) detail.style.display = 'none';
            });
            this.getPanes().overlayMouseTarget.appendChild(this.div);
        }
        draw() {
            const p = this.getProjection().fromLatLngToDivPixel(this.position);
            if (p) { this.div.style.left = (p.x - 20) + 'px'; this.div.style.top = (p.y - 15) + 'px'; }
        }
        onRemove() { if (this.div) { this.div.parentNode.removeChild(this.div); this.div = null; } }
    };

    RouteInfoOverlay = class extends google.maps.OverlayView {
        constructor(position, content, mapInstance, side) {
            super();
            this.position = position;
            this.content = content;
            this.side = side || 'top';
            this.div = null;
            this.setMap(mapInstance);
        }
        onAdd() {
            this.div = document.createElement('div');
            this.div.innerHTML = this.content;
            this.div.style.position = 'absolute';
            this.div.style.zIndex = '2';
            this.div.style.pointerEvents = 'none';
            this.getPanes().overlayMouseTarget.appendChild(this.div);
        }
        draw() {
            const p = this.getProjection().fromLatLngToDivPixel(this.position);
            if (!p) return;
            const w = this.div.offsetWidth || 80;
            const h = this.div.offsetHeight || 36;
            if (this.side === 'left') { this.div.style.left = (p.x - w - 14) + 'px'; this.div.style.top = (p.y - h / 2) + 'px'; }
            else if (this.side === 'right') { this.div.style.left = (p.x + 14) + 'px'; this.div.style.top = (p.y - h / 2) + 'px'; }
            else if (this.side === 'bottom') { this.div.style.left = (p.x - w / 2) + 'px'; this.div.style.top = (p.y + 14) + 'px'; }
            else { this.div.style.left = (p.x - w / 2) + 'px'; this.div.style.top = (p.y - h - 14) + 'px'; }
        }
        onRemove() { if (this.div) { this.div.parentNode.removeChild(this.div); this.div = null; } }
    };

    try {
        map = new google.maps.Map(document.getElementById('map'), {
            center: { lat: 39.8283, lng: -98.5795 },
            zoom: 5,
            gestureHandling: 'greedy',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER }
        });

        const originSearchBox = new google.maps.places.SearchBox(originInput);
        const destSearchBox = new google.maps.places.SearchBox(destinationInput);

        map.addListener('bounds_changed', () => {
            originSearchBox.setBounds(map.getBounds());
            destSearchBox.setBounds(map.getBounds());
        });

        originSearchBox.addListener('places_changed', () => {
            const places = originSearchBox.getPlaces();
            if (places && places.length > 0 && places[0].geometry) { map.panTo(places[0].geometry.location); map.setZoom(14); }
        });
        destSearchBox.addListener('places_changed', () => {
            const places = destSearchBox.getPlaces();
            if (places && places.length > 0 && places[0].geometry) { map.panTo(places[0].geometry.location); map.setZoom(14); }
        });

        allStopsContainer.querySelectorAll('.stop-row').forEach(row => attachStopDrag(row));

        allStopsContainer.addEventListener('focusin', (e) => {
            if (e.target.tagName !== 'INPUT') return;
            setPickMode(e.target);
        });

        allStopsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.stop-remove-btn');
            if (!btn) return;
            const row = btn.closest('.stop-row');
            const rows = allStopsContainer.querySelectorAll('.stop-row');
            if (rows.length <= 2) return;
            row.remove();
            updateStopReferences();
        });

        myLocationBtn.addEventListener('click', () => {
            if (!navigator.geolocation) { showError('Geolocation not supported.'); return; }
            myLocationBtn.style.opacity = '0.5';
            navigator.geolocation.getCurrentPosition(pos => {
                const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                if (myLocationMarker) myLocationMarker.setMap(null);
                myLocationMarker = new google.maps.Marker({
                    position: latlng, map,
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#4285f4', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
                    title: 'Your location', zIndex: 999
                });
                new google.maps.Geocoder().geocode({ location: latlng }, (results, status) => {
                    myLocationBtn.style.opacity = '1';
                    if (status === 'OK' && results[0]) { originInput.value = results[0].formatted_address; map.panTo(latlng); map.setZoom(14); }
                    else originInput.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
                });
            }, () => { myLocationBtn.style.opacity = '1'; showError('Could not get your location.'); });
        });

        swapBtn.addEventListener('click', () => {
            const tmp = originInput.value;
            originInput.value = destinationInput.value;
            destinationInput.value = tmp;
        });

        map.addListener('click', (e) => {
            if (!pickTargetInput) return;
            const latlng = e.latLng;
            if (pickMarker) pickMarker.setMap(null);
            pickMarker = new google.maps.Marker({
                position: latlng, map,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#ffffff', fillOpacity: 1, strokeColor: '#4285f4', strokeWeight: 3 },
                animation: google.maps.Animation.DROP
            });
            pickTargetInput.value = 'Loading address...';
            pickTargetInput.classList.add('chosen');
            new google.maps.Geocoder().geocode({ location: latlng }, (results, status) => {
                pickTargetInput.value = (status === 'OK' && results[0]) ? results[0].formatted_address : `${latlng.lat().toFixed(6)}, ${latlng.lng().toFixed(6)}`;
                setTimeout(() => pickTargetInput.classList.remove('chosen'), 1500);
                pickTargetInput = null;
                map.setOptions({ draggableCursor: null });
                document.querySelectorAll('.picking').forEach(el => el.classList.remove('picking'));
            });
        });

        planButton.addEventListener('click', () => {
            pickTargetInput = null;
            map.setOptions({ draggableCursor: null });
            document.querySelectorAll('.picking').forEach(el => el.classList.remove('picking'));
            planTrip();
        });

        goNowBtn.addEventListener('click', () => {
            useGoNow = true;
            goNowBtn.classList.add('active');
            pickTimeBtn.classList.remove('active');
            pickTimeSection.classList.add('hidden');
        });
        pickTimeBtn.addEventListener('click', () => {
            useGoNow = false;
            pickTimeBtn.classList.add('active');
            goNowBtn.classList.remove('active');
            pickTimeSection.classList.remove('hidden');
        });

        document.getElementById('toggle-radar').addEventListener('change', (e) => {
            if (e.target.checked) enableRadar();
            else disableRadar();
        });

        document.querySelectorAll('.travel-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.travel-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                if (mode === 'MOTORCYCLE') {
                    travelMode = 'DRIVING';
                } else {
                    travelMode = mode;
                }
                if (currentDirectionsResult) planTrip();
            });
        });

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                if (myLocationMarker) myLocationMarker.setMap(null);
                myLocationMarker = new google.maps.Marker({
                    position: latlng, map,
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#4285f4', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
                    title: 'Your location', zIndex: 999
                });
                map.panTo(latlng);
                map.setZoom(12);
                new google.maps.Geocoder().geocode({ location: latlng }, (results, status) => {
                    if (status === 'OK' && results[0] && !originInput.value) {
                        originInput.value = results[0].formatted_address;
                    }
                });
            }, () => {});
        }

        addWaypointBtn.addEventListener('click', addWaypoint);
        shareTripBtn.addEventListener('click', shareTrip);
        printTripBtn.addEventListener('click', printTrip);
        startNavBtn.addEventListener('click', startNavigation);
        document.getElementById('nav-stop-btn').addEventListener('click', stopNavigation);
        bestTimeBtn.addEventListener('click', findBestDepartureTime);

        departureSlider.addEventListener('input', () => {
            const hour = parseInt(departureSlider.value);
            const ampm = hour < 12 ? 'AM' : 'PM';
            const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
            sliderTimeLabel.textContent = `${h12}:00 ${ampm}`;
            departureTimeInput.value = `${String(hour).padStart(2, '0')}:00`;
        });
        departureSlider.addEventListener('change', () => {
            if (currentDirectionsResult) planTrip();
        });

        setInterval(updateClearButtons, 300);

        document.getElementById('show-full-trip').addEventListener('click', () => {
            if (lastRouteBounds) map.fitBounds(lastRouteBounds, { top: 20, left: 420, right: 40, bottom: 220 });
        });

        const recentToggle = document.getElementById('recent-toggle');
        if (recentToggle) {
            recentToggle.addEventListener('click', () => {
                const list = document.getElementById('recent-list');
                const arrow = document.querySelector('.toggle-arrow');
                list.classList.toggle('recent-collapsed');
                if (arrow) arrow.textContent = list.classList.contains('recent-collapsed') ? '▸' : '▾';
            });
        }

        updateStopIndicators();
        initTimelineDrag();
    } catch (err) {
        showError('Google Maps failed to initialize: ' + err.message);
    }
}
window.initApp = initApp;

function enableRadar() {
    disableRadar();
    let cacheBuster = Math.floor(Date.now() / 1000);
    radarLayer = new google.maps.ImageMapType({
        getTileUrl: (coord, zoom) => {
            if (zoom > 12 || zoom < 1) return null;
            return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${zoom}/${coord.x}/${coord.y}.png?_t=${cacheBuster}`;
        },
        tileSize: new google.maps.Size(256, 256),
        opacity: 0.6,
        name: 'Radar'
    });
    map.overlayMapTypes.insertAt(0, radarLayer);

    if (radarRefreshInterval) clearInterval(radarRefreshInterval);
    radarRefreshInterval = setInterval(() => refreshRadar(), 120000);
}

function refreshRadar() {
    if (!radarLayer) return;
    const wasEnabled = !!radarLayer;
    if (!wasEnabled) return;
    for (let i = map.overlayMapTypes.getLength() - 1; i >= 0; i--) {
        if (map.overlayMapTypes.getAt(i) === radarLayer) map.overlayMapTypes.removeAt(i);
    }
    let cacheBuster = Math.floor(Date.now() / 1000);
    radarLayer = new google.maps.ImageMapType({
        getTileUrl: (coord, zoom) => {
            if (zoom > 12 || zoom < 1) return null;
            return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${zoom}/${coord.x}/${coord.y}.png?_t=${cacheBuster}`;
        },
        tileSize: new google.maps.Size(256, 256),
        opacity: 0.6,
        name: 'Radar'
    });
    map.overlayMapTypes.insertAt(0, radarLayer);
}

function disableRadar() {
    if (radarRefreshInterval) { clearInterval(radarRefreshInterval); radarRefreshInterval = null; }
    if (!radarLayer) return;
    for (let i = map.overlayMapTypes.getLength() - 1; i >= 0; i--) {
        if (map.overlayMapTypes.getAt(i) === radarLayer) map.overlayMapTypes.removeAt(i);
    }
    radarLayer = null;
}

function addWaypoint() {
    const row = document.createElement('div');
    row.className = 'search-input-row stop-row';
    row.draggable = true;
    row.innerHTML = `
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <div class="input-dot-wrap"><span class="dot stop-dot"></span><span class="dot-line"></span></div>
        <input type="text" placeholder="Add a stop..." autocomplete="off" />
        <button class="stop-remove-btn">&times;</button>
    `;
    const lastRow = allStopsContainer.querySelector('.stop-row:last-child');
    allStopsContainer.insertBefore(row, lastRow);
    const input = row.querySelector('input');
    if (google.maps && google.maps.places) {
        const sb = new google.maps.places.SearchBox(input);
        if (map) map.addListener('bounds_changed', () => sb.setBounds(map.getBounds()));
    }
    attachStopDrag(row);
    updateStopReferences();
    input.focus();
}

function clearMap() {
    weatherOverlays.forEach(o => o.setMap(null)); weatherOverlays = [];
    directionsRenderers.forEach(r => r.setMap(null)); directionsRenderers = [];
    routeInfoOverlays.forEach(o => o.setMap(null)); routeInfoOverlays = [];
    if (pickMarker) { pickMarker.setMap(null); pickMarker = null; }
    directionsPanel.innerHTML = ''; directionsPanel.classList.add('hidden');
    tripActions.classList.add('hidden');
    document.getElementById('show-full-trip').classList.add('hidden');
}

function getDepartureTime() {
    if (useGoNow) return new Date();
    return new Date(`${departureDateInput.value}T${departureTimeInput.value}:00`);
}

async function planTrip() {
    hideError();
    if (!originInput.value.trim()) { showError('Please enter a starting point.'); return; }
    if (!destinationInput.value.trim()) { showError('Please enter a destination.'); return; }

    saveRecentSearch(originInput.value, destinationInput.value);

    planButton.disabled = true;
    planButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg> Searching...';
    routesSection.classList.remove('hidden');
    routesList.innerHTML = '<div class="loading">Finding routes...</div>';
    weatherTimeline.classList.add('hidden');
    tripActions.classList.add('hidden');
    document.getElementById('show-full-trip').classList.add('hidden');

    try {
        const waypoints = waypointInputs.filter(w => w.value.trim()).map(w => ({ location: w.value.trim(), stopover: true }));
        const result = await getRoute(originInput.value, destinationInput.value, waypoints);
        const departureTime = getDepartureTime();

        routesList.innerHTML = '<div class="loading">Loading weather...</div>';

        const maxRoutes = Math.min(result.routes.length, 3);
        const allWaypoints = [];
        for (let r = 0; r < maxRoutes; r++) allWaypoints.push(sampleWaypoints(result, r, departureTime));
        const allWeather = await Promise.all(allWaypoints.map(wp => getWeatherForWaypoints(wp)));

        const routeData = [];
        for (let r = 0; r < maxRoutes; r++) {
            const weatherData = allWeather[r];
            const withForecast = weatherData.filter(w => !w.noForecast);
            const badWeatherCount = withForecast.filter(w =>
                [55, 61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82, 85, 86, 95, 96, 99].includes(w.weatherCode)
            ).length;
            const alerts = getWeatherAlerts(weatherData);
            const roadConditions = getRoadConditions(weatherData);
            const score = calcRouteScore(weatherData);
            const safetyLabel = getSafetyLabel(score);
            const route = result.routes[r];
            const leg = route.legs[0];
            const duration = (leg.duration_in_traffic || leg.duration).value;
            routeData.push({ routeIndex: r, weatherData, badWeatherCount, alerts, roadConditions, score, safetyLabel, duration });
        }

        const fastestIdx = routeData.reduce((min, rd, i) => rd.duration < routeData[min].duration ? i : min, 0);
        const bestWeatherIdx = routeData.reduce((best, rd, i) => rd.score > routeData[best].score ? i : best, 0);
        routeData.forEach((rd, i) => { rd.isFastest = i === fastestIdx; rd.isBestWeather = i === bestWeatherIdx; });

        currentDirectionsResult = result;
        currentRouteData = routeData;
        tripActions.classList.remove('hidden');
        displayRoutes(result, routeData, departureTime);

    } catch (err) {
        showError('Could not find a route: ' + err.message);
        routesList.innerHTML = '';
    } finally {
        planButton.disabled = false;
        planButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg> Search';
    }
}

function calcRouteScore(weatherData) {
    const valid = weatherData.filter(w => !w.noForecast);
    if (!valid.length) return 5;
    let total = 0;
    for (const wp of valid) {
        let s = 10;
        const cat = getWeatherCategory(wp.weatherCode);
        if (cat === 'storm') s -= 5;
        else if (cat === 'snow') s -= 4;
        else if (cat === 'rain') s -= 2;
        else if (cat === 'cloudy') s -= 0.5;
        if (wp.windSpeed >= 40) s -= 2;
        else if (wp.windSpeed >= 25) s -= 1;
        if (wp.temperature <= 25) s -= 1;
        else if (wp.temperature >= 105) s -= 1;
        if (wp.precipitationProb >= 70) s -= 1;
        total += Math.max(0, s);
    }
    return Math.round((total / valid.length) * 10) / 10;
}

function getSafetyLabel(score) {
    if (score >= 9) return { text: 'Very safe drive', cls: 'safety-great', icon: '🟢' };
    if (score >= 7) return { text: 'Safe drive', cls: 'safety-good', icon: '🟡' };
    if (score >= 5) return { text: 'Use caution', cls: 'safety-caution', icon: '🟠' };
    return { text: 'Unsafe conditions', cls: 'safety-danger', icon: '🔴' };
}

function getDaylightInfo(weatherData) {
    if (!weatherData.length) return '';
    const start = weatherData[0].arrivalTime;
    const end = weatherData[weatherData.length - 1].arrivalTime;
    const totalMin = (end - start) / 60000;
    if (totalMin <= 0) return '';
    let darkMin = 0;
    for (let i = 0; i < weatherData.length - 1; i++) {
        const wp = weatherData[i];
        const next = weatherData[i + 1];
        const segMin = (next.arrivalTime - wp.arrivalTime) / 60000;
        const h = wp.arrivalTime.getHours();
        if (h < 6 || h >= 20) darkMin += segMin;
        else if (h >= 19) darkMin += segMin * 0.5;
        else if (h < 7) darkMin += segMin * 0.5;
    }
    const dayPct = Math.round(((totalMin - darkMin) / totalMin) * 100);
    const darkPct = 100 - dayPct;
    if (darkPct === 0) return '☀️ 100% daylight';
    if (dayPct === 0) return '🌙 100% dark';
    return `☀️ ${dayPct}% day · 🌙 ${darkPct}% dark`;
}

function getRoadConditions(weatherData) {
    const conditions = [];
    for (const wp of weatherData.filter(w => !w.noForecast)) {
        if (wp.temperature <= 32 && [61,63,65,66,67,80,81,82,51,53,55].includes(wp.weatherCode))
            conditions.push({ type: 'danger', icon: '🧊', text: `Icy roads near ${wp.locationName}` });
        else if (wp.temperature <= 32 && [71,73,75,77,85,86].includes(wp.weatherCode))
            conditions.push({ type: 'danger', icon: '🧊', text: `Snow-covered roads near ${wp.locationName}` });
        else if ([61,63,65,80,81,82].includes(wp.weatherCode))
            conditions.push({ type: 'warning', icon: '💧', text: `Wet roads near ${wp.locationName}` });
        if (wp.weatherCode === 45 || wp.weatherCode === 48)
            conditions.push({ type: 'warning', icon: '🌫️', text: `Low visibility near ${wp.locationName}` });
        if (wp.windSpeed >= 40)
            conditions.push({ type: 'warning', icon: '💨', text: `Crosswinds near ${wp.locationName}` });
    }
    return conditions;
}

function displayRoutes(directionsResult, routeData, departureTime) {
    clearMap();
    routesList.innerHTML = '';

    function selectRoute(selectedIdx) {
        directionsRenderers.forEach(r => r.setMap(null));
        directionsRenderers = [];
        routeInfoOverlays.forEach(o => o.setMap(null));
        routeInfoOverlays = [];

        routeData.forEach((rd, i) => {
            const isSelected = i === selectedIdx;
            const route = directionsResult.routes[rd.routeIndex];
            const leg = route.legs[0];
            const renderer = new google.maps.DirectionsRenderer({
                map, directions: directionsResult, routeIndex: rd.routeIndex,
                suppressMarkers: !isSelected, preserveViewport: true,
                polylineOptions: { strokeColor: isSelected ? '#4285f4' : '#a8c7fa', strokeWeight: isSelected ? 5 : 4, strokeOpacity: isSelected ? 1.0 : 0.7, zIndex: isSelected ? 10 : 1 }
            });
            directionsRenderers.push(renderer);

            const path = route.overview_path;
            const durationSec = (leg.duration_in_traffic || leg.duration).value;
            const distMiles = Math.round(leg.distance.value / 1609.34);
            let labelPoint, side;
            if (isSelected) {
                labelPoint = path[Math.floor(path.length * 0.5)];
                side = 'bottom';
            } else {
                const selPath = directionsResult.routes[routeData[selectedIdx].routeIndex].overview_path;
                let maxDist = 0, bestIdx = Math.floor(path.length * 0.5);
                for (let pi = Math.floor(path.length * 0.2); pi < Math.floor(path.length * 0.8); pi++) {
                    let minD = Infinity;
                    for (let si = 0; si < selPath.length; si += Math.max(1, Math.floor(selPath.length / 50))) {
                        const d = Math.abs(path[pi].lat() - selPath[si].lat()) + Math.abs(path[pi].lng() - selPath[si].lng());
                        if (d < minD) minD = d;
                    }
                    if (minD > maxDist) { maxDist = minD; bestIdx = pi; }
                }
                labelPoint = path[bestIdx];
                const selMid = selPath[Math.floor(selPath.length / 2)];
                const dx = selMid.lng() - labelPoint.lng(), dy = selMid.lat() - labelPoint.lat();
                side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
            }
            const infoHtml = `<div class="route-info-box ${isSelected ? '' : 'alt'} arrow-${side}"><div class="rib-duration">${formatDuration(durationSec)}</div><div class="rib-distance">${distMiles} mi</div></div>`;
            routeInfoOverlays.push(new RouteInfoOverlay(labelPoint, infoHtml, map, side));
        });

        document.querySelectorAll('.route-option').forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
        const rd = routeData[selectedIdx];
        currentWeatherData = rd.weatherData;
        showWeatherCards(rd.weatherData);
        showWeatherChart(rd.weatherData);
        showOverlaysOnMap(rd.weatherData);
        showDirections(directionsResult, rd.routeIndex, rd);
    }

    routeData.forEach((rd, idx) => {
        const route = directionsResult.routes[rd.routeIndex];
        const leg = route.legs[0];
        const durationText = formatDuration((leg.duration_in_traffic || leg.duration).value);
        const distMiles = Math.round(leg.distance.value / 1609.34);
        const summary = route.summary || `Route ${idx + 1}`;
        const { barHtml: weatherBarHtml, iconsHtml: weatherIconsHtml } = buildWeatherBar(rd.weatherData);
        const traffic = getStepTrafficSegments(route);
        const trafficBarHtml = traffic.segments.map(s => `<div style="flex:${s.pct};background:${s.color};height:100%;"></div>`).join('');
        const daylightInfo = getDaylightInfo(rd.weatherData);

        let badgesHtml = `<span class="badge ${rd.safetyLabel.cls}">${rd.safetyLabel.icon} ${rd.safetyLabel.text}</span>`;
        if (rd.isFastest && routeData.length > 1) badgesHtml += '<span class="badge badge-fastest">Fastest</span>';
        if (rd.isBestWeather && routeData.length > 1) badgesHtml += '<span class="badge badge-best-weather">Best weather</span>';
        if (rd.badWeatherCount > 0) badgesHtml += `<span class="badge badge-bad-weather">${rd.badWeatherCount} bad stretch${rd.badWeatherCount > 1 ? 'es' : ''}</span>`;

        let conditionsHtml = '';
        const allConditions = [...rd.roadConditions, ...rd.alerts];
        if (allConditions.length > 0) {
            conditionsHtml = '<div class="route-alerts-compact">' + allConditions.slice(0, 3).map(a => {
                const cls = a.type === 'danger' ? 'danger' : a.type === 'warning' ? 'warning' : 'caution';
                return `<div class="alert-inline ${cls}">${a.icon} ${a.text}</div>`;
            }).join('') + '</div>';
        }

        const modeLabel = getModeLabel();

        const btn = document.createElement('button');
        btn.className = `route-option ${idx === 0 ? 'selected' : ''}`;
        btn.innerHTML = `
            <div class="route-option-header">
                <span class="route-name">via ${summary}</span>
                <span class="route-duration">${durationText}</span>
            </div>
            <div class="route-meta">${distMiles} miles · ${modeLabel}${daylightInfo ? ` · ${daylightInfo}` : ''}</div>
            <div class="route-badges">${badgesHtml}</div>
            <div class="route-bars-compact">
                <div class="bar-row-compact weather-bar-row">
                    <span class="bar-icon" title="Weather">🌤</span>
                    <div class="bar-track-wrap">
                        <div class="weather-icons-row">${weatherIconsHtml}</div>
                        <div class="bar-track"><div class="bar-fill">${weatherBarHtml}</div></div>
                    </div>
                </div>
                <div class="bar-row-compact">
                    <span class="bar-icon" title="Traffic">🚗</span>
                    <div class="bar-track"><div class="bar-fill">${trafficBarHtml}</div></div>
                    <span class="bar-info" style="color:${traffic.labelColor}">${traffic.label}</span>
                </div>
            </div>
            ${conditionsHtml}
        `;
        btn.addEventListener('click', () => selectRoute(idx));
        routesList.appendChild(btn);
    });

    selectRoute(0);
    const bounds = new google.maps.LatLngBounds();
    directionsResult.routes.forEach(r => r.overview_path.forEach(p => bounds.extend(p)));
    lastRouteBounds = bounds;
    map.fitBounds(bounds, { top: 20, left: 420, right: 40, bottom: 220 });
    document.getElementById('show-full-trip').classList.remove('hidden');
}

function getModeLabel() {
    const activeBtn = document.querySelector('.travel-mode-btn.active');
    const mode = activeBtn ? activeBtn.dataset.mode : 'DRIVING';
    const labels = { DRIVING: '🚗 Driving', MOTORCYCLE: '🏍️ Motorcycle', BICYCLING: '🚴 Cycling', WALKING: '🚶 Walking' };
    return labels[mode] || '🚗 Driving';
}

function showDirections(directionsResult, routeIndex, rd) {
    directionsPanel.classList.remove('hidden');
    directionsPanel.innerHTML = '';
    const route = directionsResult.routes[routeIndex];
    const leg = route.legs[0];

    const header = document.createElement('div');
    header.className = 'directions-header';
    let headerContent = `<div class="dir-route-summary">
        <div class="dir-endpoints"><strong>${leg.start_address.split(',')[0]}</strong> → <strong>${leg.end_address.split(',')[0]}</strong></div>
        <div class="dir-stats">${formatDuration((leg.duration_in_traffic || leg.duration).value)} · ${Math.round(leg.distance.value / 1609.34)} mi · ${getModeLabel()}</div>`;
    if (rd) {
        headerContent += `<div class="dir-safety ${rd.safetyLabel.cls}">${rd.safetyLabel.icon} ${rd.safetyLabel.text}</div>`;
        const daylight = getDaylightInfo(rd.weatherData);
        if (daylight) headerContent += `<div class="dir-daylight">${daylight}</div>`;
    }
    headerContent += '</div>';
    header.innerHTML = headerContent;
    directionsPanel.appendChild(header);

    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'steps-list';

    leg.steps.forEach((step, i) => {
        const row = document.createElement('div');
        row.className = 'direction-step';
        const icon = getManeuverIcon(step.maneuver || '', step.instructions || '');
        row.innerHTML = `
            <div class="step-number">${i + 1}</div>
            <div class="step-icon">${icon}</div>
            <div class="step-content">
                <div class="step-instruction">${step.instructions}</div>
                <div class="step-dist">${step.distance ? step.distance.text : ''} ${step.duration ? '· ' + step.duration.text : ''}</div>
            </div>
        `;
        row.addEventListener('click', () => { map.panTo(step.start_location); map.setZoom(16); });
        stepsContainer.appendChild(row);
    });

    const arrive = document.createElement('div');
    arrive.className = 'direction-step arrive';
    arrive.innerHTML = `<div class="step-number">✓</div><div class="step-icon">📍</div><div class="step-content"><div class="step-instruction"><strong>Arrive at ${leg.end_address.split(',')[0]}</strong></div></div>`;
    stepsContainer.appendChild(arrive);

    directionsPanel.appendChild(stepsContainer);
}

function showWeatherChart(weatherData) {
    const valid = weatherData.filter(w => !w.noForecast);
    if (valid.length < 2) { weatherChart.innerHTML = ''; return; }
    const maxTemp = Math.max(...valid.map(w => w.temperature));
    const minTemp = Math.min(...valid.map(w => w.temperature));
    const range = Math.max(maxTemp - minTemp, 10);
    const chartH = 60;
    const w = valid.length * 60;

    let tempPath = '';
    let precipBars = '';
    valid.forEach((wp, i) => {
        const x = i * 60 + 30;
        const y = chartH - ((wp.temperature - minTemp) / range) * (chartH - 10) - 5;
        if (i === 0) tempPath += `M${x},${y}`;
        else tempPath += ` L${x},${y}`;
        const precipH = (wp.precipitationProb / 100) * chartH;
        precipBars += `<rect x="${x - 8}" y="${chartH - precipH}" width="16" height="${precipH}" fill="#4285f4" opacity="0.2" rx="2"/>`;
    });

    let labels = '';
    valid.forEach((wp, i) => {
        const x = i * 60 + 30;
        const y = chartH - ((wp.temperature - minTemp) / range) * (chartH - 10) - 5;
        labels += `<text x="${x}" y="${y - 6}" text-anchor="middle" font-size="10" fill="#202124" font-weight="600">${Math.round(wp.temperature)}°</text>`;
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        labels += `<text x="${x}" y="${chartH + 12}" text-anchor="middle" font-size="9" fill="#9aa0a6">${timeStr}</text>`;
        if (wp.precipitationProb > 0) {
            labels += `<text x="${x}" y="${chartH + 22}" text-anchor="middle" font-size="9" fill="#4285f4">${wp.precipitationProb}%</text>`;
        }
    });

    let iconLabels = '';
    valid.forEach((wp, i) => {
        const x = i * 60 + 30;
        const info = weatherCodeToInfo(wp.weatherCode);
        iconLabels += `<text x="${x}" y="${chartH + 40}" text-anchor="middle" font-size="14">${info.icon}</text>`;
    });

    weatherChart.innerHTML = `<svg width="${w}" height="${chartH + 48}" viewBox="0 0 ${w} ${chartH + 48}">
        ${precipBars}
        <path d="${tempPath}" fill="none" stroke="#ea4335" stroke-width="2"/>
        ${valid.map((wp, i) => {
            const x = i * 60 + 30;
            const y = chartH - ((wp.temperature - minTemp) / range) * (chartH - 10) - 5;
            return `<circle cx="${x}" cy="${y}" r="3" fill="#ea4335"/>`;
        }).join('')}
        ${labels}
        ${iconLabels}
    </svg>`;
}

function getWeatherAlerts(weatherData) {
    const alerts = [];
    for (const wp of weatherData.filter(w => !w.noForecast)) {
        const info = weatherCodeToInfo(wp.weatherCode);
        const cat = getWeatherCategory(wp.weatherCode);
        if (cat === 'storm') alerts.push({ type: 'danger', icon: '⚡', text: `${info.desc} near ${wp.locationName}` });
        else if (cat === 'snow') alerts.push({ type: 'warning', icon: '🌨️', text: `${info.desc} near ${wp.locationName}` });
        else if (wp.weatherCode === 65 || wp.weatherCode === 82) alerts.push({ type: 'warning', icon: '🌧️', text: `${info.desc} near ${wp.locationName}` });
        else if (wp.weatherCode === 45 || wp.weatherCode === 48) alerts.push({ type: 'caution', icon: '🌫️', text: `${info.desc} near ${wp.locationName}` });
        if (wp.windSpeed >= 30) alerts.push({ type: 'warning', icon: '💨', text: `High winds (${Math.round(wp.windSpeed)} mph) near ${wp.locationName}` });
        if (wp.temperature <= 32) alerts.push({ type: 'caution', icon: '🥶', text: `Freezing (${Math.round(wp.temperature)}°F) near ${wp.locationName}` });
        else if (wp.temperature >= 100) alerts.push({ type: 'caution', icon: '🔥', text: `Extreme heat (${Math.round(wp.temperature)}°F) near ${wp.locationName}` });
    }
    return alerts;
}

async function findBestDepartureTime() {
    if (!originInput.value.trim() || !destinationInput.value.trim()) {
        showError('Enter origin and destination first.');
        return;
    }
    bestTimeBtn.disabled = true;
    bestTimeBtn.textContent = 'Analyzing...';
    bestTimeResult.classList.remove('hidden');
    bestTimeResult.innerHTML = '<div class="loading">Checking weather for different times...</div>';

    try {
        const waypoints = waypointInputs.filter(w => w.value.trim()).map(w => ({ location: w.value.trim(), stopover: true }));
        const result = await getRoute(originInput.value, destinationInput.value, waypoints);
        const today = departureDateInput.value || new Date().toISOString().split('T')[0];
        const hours = [6, 8, 10, 12, 14, 16, 18];
        const results = [];

        for (const h of hours) {
            const depTime = new Date(`${today}T${String(h).padStart(2,'0')}:00:00`);
            if (depTime < new Date()) continue;
            const wp = sampleWaypoints(result, 0, depTime);
            const weather = await getWeatherForWaypoints(wp);
            const score = calcRouteScore(weather);
            const safety = getSafetyLabel(score);
            results.push({ hour: h, score, safety, weather });
        }

        if (!results.length) {
            bestTimeResult.innerHTML = '<div class="best-time-card">No future departure times available today.</div>';
            return;
        }

        results.sort((a, b) => b.score - a.score);
        const best = results[0];
        const ampm = best.hour < 12 ? 'AM' : 'PM';
        const h12 = best.hour === 0 ? 12 : best.hour > 12 ? best.hour - 12 : best.hour;

        let html = `<div class="best-time-card">
            <button class="best-time-close" onclick="document.getElementById('best-time-result').classList.add('hidden')">&times;</button>
            <div class="best-time-title">Best time to leave</div>
            <div class="best-time-value">${h12}:00 ${ampm}</div>
            <div class="best-time-safety ${best.safety.cls}">${best.safety.icon} ${best.safety.text}</div>
            <div class="best-time-options">`;
        results.forEach(r => {
            const ap = r.hour < 12 ? 'AM' : 'PM';
            const h = r.hour === 0 ? 12 : r.hour > 12 ? r.hour - 12 : r.hour;
            const isB = r === best;
            html += `<button class="best-time-option ${isB ? 'best' : ''}" data-hour="${r.hour}">
                <span class="bto-time">${h}${ap}</span>
                <span class="bto-safety ${r.safety.cls}">${r.safety.icon}</span>
            </button>`;
        });
        html += '</div></div>';
        bestTimeResult.innerHTML = html;

        bestTimeResult.querySelectorAll('.best-time-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const hour = parseInt(btn.dataset.hour);
                useGoNow = false;
                pickTimeBtn.classList.add('active');
                goNowBtn.classList.remove('active');
                pickTimeSection.classList.remove('hidden');
                departureTimeInput.value = `${String(hour).padStart(2,'0')}:00`;
                departureSlider.value = hour;
                const ap = hour < 12 ? 'AM' : 'PM';
                const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                sliderTimeLabel.textContent = `${h}:00 ${ap}`;
                planTrip();
            });
        });

    } catch (err) {
        bestTimeResult.innerHTML = `<div class="best-time-card">Could not analyze: ${err.message}</div>`;
    } finally {
        bestTimeBtn.disabled = false;
        bestTimeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg> Best departure time';
    }
}

function getRoute(origin, destination, waypoints) {
    return new Promise((resolve, reject) => {
        const mode = google.maps.TravelMode[travelMode];
        if (!mode) {
            reject(new Error('Invalid travel mode: ' + travelMode));
            return;
        }
        const req = {
            origin, destination,
            travelMode: mode,
            provideRouteAlternatives: true
        };
        if (travelMode === 'DRIVING') {
            req.drivingOptions = { departureTime: new Date(), trafficModel: 'bestguess' };
        }
        if (waypoints && waypoints.length > 0) req.waypoints = waypoints;
        new google.maps.DirectionsService().route(req, (result, status) => {
            if (status === 'OK') resolve(result);
            else reject(new Error(status));
        });
    });
}

function sampleWaypoints(directionsResult, routeIndex, departureTime) {
    const route = directionsResult.routes[routeIndex];
    const legs = route.legs;
    let totalDuration = 0, totalDistance = 0;
    for (const leg of legs) {
        totalDuration += (leg.duration_in_traffic || leg.duration).value;
        totalDistance += leg.distance.value;
    }
    const totalMiles = totalDistance / 1609.34;
    const totalMinutes = totalDuration / 60;
    const path = route.overview_path;
    const byMiles = Math.ceil(totalMiles / 20) + 1;
    const byMinutes = Math.ceil(totalMinutes / 20) + 1;
    const numStops = Math.min(Math.max(Math.max(byMiles, byMinutes), 3), 12);
    const waypoints = [];

    for (let i = 0; i < numStops; i++) {
        const fraction = i / (numStops - 1);
        const pathIndex = Math.min(Math.floor(fraction * (path.length - 1)), path.length - 1);
        const point = path[pathIndex];
        const elapsedSeconds = fraction * totalDuration;
        const arrivalTime = new Date(departureTime.getTime() + elapsedSeconds * 1000);
        const distanceMiles = (fraction * totalDistance / 1609.34).toFixed(0);
        waypoints.push({ lat: point.lat(), lon: point.lng(), arrivalTime, distanceMiles, fraction, isStart: i === 0, isEnd: i === numStops - 1 });
    }
    waypoints[0].locationName = legs[0].start_address.split(',')[0];
    waypoints[numStops - 1].locationName = legs[legs.length - 1].end_address.split(',')[0];
    return waypoints;
}

async function reverseGeocode(lat, lon) {
    return new Promise(resolve => {
        new google.maps.Geocoder().geocode({ location: { lat, lng: lon } }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const c = results[0].address_components;
                const city = c.find(x => x.types.includes('locality'));
                const county = c.find(x => x.types.includes('administrative_area_level_2'));
                resolve(city ? city.long_name : county ? county.long_name : results[0].formatted_address.split(',')[0]);
            } else resolve(`${lat.toFixed(2)}, ${lon.toFixed(2)}`);
        });
    });
}

async function getWeatherForWaypoints(waypoints) {
    const names = await Promise.all(waypoints.map(wp =>
        wp.locationName ? Promise.resolve(wp.locationName) : reverseGeocode(wp.lat, wp.lon)
    ));
    return Promise.all(waypoints.map(async (wp, i) => {
        const dateStr = wp.arrivalTime.toISOString().split('T')[0];
        const hour = wp.arrivalTime.getHours();
        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${wp.lat}&longitude=${wp.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`);
            const data = await res.json();
            if (data.error || !data.hourly || !data.hourly.temperature_2m)
                return { ...wp, locationName: names[i], noForecast: true };
            const h = Math.min(hour, data.hourly.time.length - 1);
            return {
                ...wp, locationName: names[i],
                temperature: data.hourly.temperature_2m[h],
                humidity: data.hourly.relative_humidity_2m[h],
                precipitationProb: data.hourly.precipitation_probability[h],
                precipitationAmount: data.hourly.precipitation ? data.hourly.precipitation[h] : 0,
                weatherCode: data.hourly.weathercode[h],
                windSpeed: data.hourly.windspeed_10m[h]
            };
        } catch { return { ...wp, locationName: names[i], noForecast: true }; }
    }));
}

const weatherCategories = {
    clear: { label: 'Clear', color: '#34a853', icon: '☀️', codes: [0, 1] },
    cloudy: { label: 'Cloudy', color: '#9aa0a6', icon: '☁️', codes: [2, 3, 45, 48] },
    rain: { label: 'Rain', color: '#4285f4', icon: '🌧️', codes: [51, 53, 55, 61, 63, 65, 80, 81, 82] },
    snow: { label: 'Snow', color: '#a855f7', icon: '🌨️', codes: [66, 67, 71, 73, 75, 77, 85, 86] },
    storm: { label: 'Storm', color: '#ea4335', icon: '⚡', codes: [95, 96, 99] },
};

function getWeatherCategory(code) {
    if (code === null || code === undefined) return 'unknown';
    for (const [key, val] of Object.entries(weatherCategories)) { if (val.codes.includes(code)) return key; }
    return 'clear';
}

function weatherCodeToInfo(code) {
    const m = { 0:{icon:'☀️',desc:'Clear sky'},1:{icon:'🌤️',desc:'Mainly clear'},2:{icon:'⛅',desc:'Partly cloudy'},3:{icon:'☁️',desc:'Overcast'},45:{icon:'🌫️',desc:'Foggy'},48:{icon:'🌫️',desc:'Freezing fog'},51:{icon:'🌦️',desc:'Light drizzle'},53:{icon:'🌦️',desc:'Moderate drizzle'},55:{icon:'🌧️',desc:'Heavy drizzle'},61:{icon:'🌧️',desc:'Light rain'},63:{icon:'🌧️',desc:'Moderate rain'},65:{icon:'🌧️',desc:'Heavy rain'},66:{icon:'❄️',desc:'Freezing rain'},67:{icon:'❄️',desc:'Heavy freezing rain'},71:{icon:'🌨️',desc:'Light snow'},73:{icon:'🌨️',desc:'Moderate snow'},75:{icon:'🌨️',desc:'Heavy snow'},77:{icon:'❄️',desc:'Snow grains'},80:{icon:'🌦️',desc:'Light showers'},81:{icon:'🌧️',desc:'Moderate showers'},82:{icon:'⛈️',desc:'Violent showers'},85:{icon:'🌨️',desc:'Light snow showers'},86:{icon:'🌨️',desc:'Heavy snow showers'},95:{icon:'⚡',desc:'Thunderstorm'},96:{icon:'⚡',desc:'Thunderstorm + hail'},99:{icon:'⚡',desc:'Thunderstorm + heavy hail'} };
    return m[code] || { icon: '❓', desc: 'Unknown' };
}

function buildWeatherBar(weatherData) {
    const segments = [], icons = [];
    for (let i = 0; i < weatherData.length; i++) {
        const wp = weatherData[i];
        const cat = getWeatherCategory(wp.weatherCode);
        const catInfo = cat === 'unknown' ? { color: '#e8eaed', icon: '❓' } : weatherCategories[cat];
        const info = wp.noForecast ? { icon: '—' } : weatherCodeToInfo(wp.weatherCode);
        icons.push({ icon: info.icon, fraction: wp.fraction });
        if (i < weatherData.length - 1) segments.push({ width: (weatherData[i + 1].fraction - wp.fraction) * 100, color: catInfo.color });
    }
    return {
        barHtml: segments.map(s => `<div style="flex:${s.width};background:${s.color};height:100%;"></div>`).join(''),
        iconsHtml: icons.map(ic => `<span class="weather-bar-icon" style="left:${ic.fraction * 100}%">${ic.icon}</span>`).join('')
    };
}

function getStepTrafficSegments(route) {
    const leg = route.legs[0];
    const totalDuration = leg.duration.value;
    const totalTraffic = leg.duration_in_traffic ? leg.duration_in_traffic.value : totalDuration;
    const ratio = totalTraffic / totalDuration;
    const green = '#34a853', orange = '#fbbc04', red = '#ea4335';
    if (!leg.duration_in_traffic || ratio <= 1.02) return { segments: [{ pct: 100, color: green }], label: 'Clear', labelColor: green };
    const delayMin = Math.round((totalTraffic - totalDuration) / 60);
    const raw = [];
    for (const step of leg.steps) { const pct = (step.duration.value / totalDuration) * 100; const speed = (step.distance.value / 1000) / (step.duration.value / 3600 || 1); raw.push({ pct, color: speed >= 70 ? green : speed >= 30 ? orange : red }); }
    const merged = [];
    for (const s of raw) { const l = merged[merged.length - 1]; if (l && l.color === s.color) l.pct += s.pct; else merged.push({ ...s }); }
    const labelColor = ratio <= 1.1 ? green : ratio <= 1.25 ? orange : red;
    return { segments: merged, label: `+${delayMin}m`, labelColor };
}

function showOverlaysOnMap(weatherData) {
    weatherOverlays.forEach(o => o.setMap(null)); weatherOverlays = [];
    weatherData.forEach(wp => {
        const info = wp.noForecast ? { icon: '—', desc: 'No forecast' } : weatherCodeToInfo(wp.weatherCode);
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = wp.arrivalTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const temp = wp.noForecast ? '?' : `${Math.round(wp.temperature)}°`;
        let detail;
        if (wp.noForecast) detail = `<div class="overlay-detail"><strong>${wp.locationName}</strong><br>${timeStr} · ${dateStr}<br><span style="color:#9aa0a6">No forecast</span></div>`;
        else {
            const precip = wp.precipitationAmount > 0 ? `<br>Precip: ${wp.precipitationAmount.toFixed(2)}" · ${wp.precipitationProb}%` : (wp.precipitationProb > 0 ? `<br>${wp.precipitationProb}% chance of precip` : '');
            detail = `<div class="overlay-detail"><strong>${wp.locationName}</strong><br>${timeStr} · ${dateStr}<br>${info.desc}<br>Wind: ${Math.round(wp.windSpeed)} mph${precip}</div>`;
        }
        const html = `<div class="weather-overlay-minimal${wp.noForecast ? ' no-forecast' : ''}"><span class="overlay-icon-mini">${info.icon}</span><span class="overlay-temp-mini">${temp}</span>${detail}</div>`;
        weatherOverlays.push(new WeatherOverlay(new google.maps.LatLng(wp.lat, wp.lon), html, map));
    });
}

function showWeatherCards(weatherData) {
    weatherTimeline.classList.remove('hidden');
    timelineCards.innerHTML = '';
    weatherData.forEach(wp => {
        const info = wp.noForecast ? { icon: '—', desc: 'No forecast' } : weatherCodeToInfo(wp.weatherCode);
        const cat = getWeatherCategory(wp.weatherCode);
        const catInfo = (cat !== 'unknown' && weatherCategories[cat]) ? weatherCategories[cat] : { color: '#9aa0a6' };
        const borderColor = wp.noForecast ? '#e8eaed' : catInfo.color;
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const label = wp.isStart ? 'Start' : wp.isEnd ? 'End' : `${wp.distanceMiles} mi`;
        const card = document.createElement('div');
        card.className = 'weather-card';
        card.style.borderLeftColor = borderColor;
        if (wp.noForecast) {
            card.innerHTML = `<div class="card-top"><div class="weather-icon" style="opacity:0.4">—</div><div class="card-info"><div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${label}</div></div></div><div class="temp" style="color:#9aa0a6">N/A</div>`;
        } else {
            const precipText = wp.precipitationAmount > 0 ? `${wp.precipitationAmount.toFixed(2)}"` : `${wp.precipitationProb}%`;
            card.innerHTML = `<div class="card-top"><div class="weather-icon">${info.icon}</div><div class="card-info"><div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${label}</div></div></div><div class="card-weather-row"><span class="temp">${Math.round(wp.temperature)}°F</span><span class="description">${info.desc}</span></div><div class="extra">💨 ${Math.round(wp.windSpeed)} mph · 💧 ${precipText}</div>`;
        }
        card.addEventListener('click', () => { map.panTo({ lat: wp.lat, lng: wp.lon }); map.setZoom(10); });
        timelineCards.appendChild(card);
    });
}

function shareTrip() {
    if (!currentWeatherData || !currentDirectionsResult) return;
    const route = currentDirectionsResult.routes[0];
    const leg = route.legs[0];
    const text = `🚗 Trip: ${leg.start_address.split(',')[0]} → ${leg.end_address.split(',')[0]}\n⏱ ${formatDuration((leg.duration_in_traffic || leg.duration).value)} · ${Math.round(leg.distance.value / 1609.34)} miles\n\n🌤 Weather along the route:\n` +
        currentWeatherData.filter(w => !w.noForecast).map(w => {
            const info = weatherCodeToInfo(w.weatherCode);
            const time = w.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${time} - ${w.locationName}: ${info.icon} ${Math.round(w.temperature)}°F ${info.desc}`;
        }).join('\n');

    if (navigator.share) {
        navigator.share({ title: 'Weather on the Road', text }).catch(() => {});
    } else {
        navigator.clipboard.writeText(text).then(() => {
            const orig = shareTripBtn.innerHTML;
            shareTripBtn.innerHTML = '✓ Copied!';
            setTimeout(() => shareTripBtn.innerHTML = orig, 2000);
        });
    }
}

function printTrip() {
    if (!currentWeatherData || !currentDirectionsResult) return;
    const rd = currentRouteData.find(r => r.weatherData === currentWeatherData);
    const route = currentDirectionsResult.routes[rd ? rd.routeIndex : 0];
    const leg = route.legs[0];
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Trip Summary</title><style>body{font-family:'Inter',Arial,sans-serif;max-width:800px;margin:20px auto;padding:0 20px;color:#202124}h1{color:#4285f4;font-size:20px}h2{font-size:16px;margin-top:24px;border-bottom:2px solid #e8eaed;padding-bottom:6px;color:#202124}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{padding:8px 12px;text-align:left;border-bottom:1px solid #e8eaed;font-size:13px}th{background:#f8f9fa;font-weight:600}.safety{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block;margin:6px 0}@media print{body{margin:0}}</style></head><body>`);
    w.document.write(`<h1>🚗 Trip: ${leg.start_address} → ${leg.end_address}</h1>`);
    w.document.write(`<p>${formatDuration((leg.duration_in_traffic || leg.duration).value)} · ${Math.round(leg.distance.value / 1609.34)} miles via ${route.summary || 'route'}</p>`);
    if (rd) w.document.write(`<p class="safety" style="background:#e6f4ea;color:#137333">${rd.safetyLabel.icon} ${rd.safetyLabel.text}</p>`);
    w.document.write(`<h2>Weather Forecast</h2><table><tr><th>Time</th><th>Location</th><th>Weather</th><th>Temp</th><th>Wind</th><th>Precip</th></tr>`);
    currentWeatherData.filter(wp => !wp.noForecast).forEach(wp => {
        const info = weatherCodeToInfo(wp.weatherCode);
        const time = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const precip = wp.precipitationAmount > 0 ? `${wp.precipitationAmount.toFixed(2)}"` : `${wp.precipitationProb}%`;
        w.document.write(`<tr><td>${time}</td><td>${wp.locationName}</td><td>${info.icon} ${info.desc}</td><td>${Math.round(wp.temperature)}°F</td><td>${Math.round(wp.windSpeed)} mph</td><td>${precip}</td></tr>`);
    });
    w.document.write(`</table>`);
    if (rd && (rd.roadConditions.length || rd.alerts.length)) {
        w.document.write(`<h2>Warnings</h2><ul>`);
        [...rd.roadConditions, ...rd.alerts].forEach(a => w.document.write(`<li>${a.icon} ${a.text}</li>`));
        w.document.write(`</ul>`);
    }
    w.document.write(`<h2>Directions</h2><ol>`);
    leg.steps.forEach(step => w.document.write(`<li>${step.instructions} — ${step.distance ? step.distance.text : ''}</li>`));
    w.document.write(`</ol><p style="color:#9aa0a6;font-size:11px;margin-top:30px">Generated by Weather on the Road · ${new Date().toLocaleDateString()}</p></body></html>`);
    w.document.close();
    w.print();
}

function saveRecentSearch(origin, destination) {
    const key = 'weatherroad_recent';
    let recent = JSON.parse(localStorage.getItem(key) || '[]');
    recent = recent.filter(r => !(r.origin === origin && r.destination === destination));
    recent.unshift({ origin, destination, date: new Date().toISOString() });
    if (recent.length > 5) recent = recent.slice(0, 5);
    localStorage.setItem(key, JSON.stringify(recent));
    loadRecentSearches();
}

function loadRecentSearches() {
    const recent = JSON.parse(localStorage.getItem('weatherroad_recent') || '[]');
    if (!recent.length) { recentSearchesDiv.classList.add('hidden'); return; }
    recentSearchesDiv.classList.remove('hidden');
    recentList.innerHTML = '';
    recent.forEach(r => {
        const item = document.createElement('button');
        item.className = 'recent-item';
        item.innerHTML = `<span class="recent-route">📍 ${r.origin.split(',')[0]} → ${r.destination.split(',')[0]}</span>`;
        item.addEventListener('click', () => {
            originInput.value = r.origin;
            destinationInput.value = r.destination;
        });
        recentList.appendChild(item);
    });
}

function getManeuverIcon(maneuver, instructions) {
    const text = (maneuver + ' ' + instructions).toLowerCase();
    if (text.includes('uturn') || text.includes('u-turn')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M18 9v12h-2V9c0-2.21-1.79-4-4-4S8 6.79 8 9v4.17l1.59-1.59L11 13l-4 4-4-4 1.41-1.41L6 13.17V9c0-3.31 2.69-6 6-6s6 2.69 6 6z"/></svg>';
    if (text.includes('sharp-left') || text.includes('sharp left')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M6 6.83L4.41 8.41 3 7l4-4 4 4-1.41 1.41L8 6.83V13h8c1.1 0 2 .9 2 2v6h-2v-6H8c-1.1 0-2-.9-2-2V6.83z"/></svg>';
    if (text.includes('sharp-right') || text.includes('sharp right')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M18 6.83l-1.59 1.58L15 7l4-4 4 4-1.41 1.41L20 6.83V13h-8c-1.1 0-2 .9-2 2v6H8v-6c0-1.1-.9-2-2-2h8V6.83z"/></svg>';
    if (text.includes('turn-left') || text.includes('turn left') || text.includes('left')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M14 7l-5 5 5 5V7zm7 10v2H3v-2h18z"/></svg>';
    if (text.includes('turn-right') || text.includes('turn right') || text.includes('right')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M10 17l5-5-5-5v10zm-7 0v2h18v-2H3z"/></svg>';
    if (text.includes('roundabout')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-13v2.17l-1.59-1.59L8 9l4 4 4-4-1.41-1.41L13 9.17V7h-2z"/></svg>';
    if (text.includes('merge')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M17 4l-1.41 1.41L17.17 7H8c-2.76 0-5 2.24-5 5v5h2v-5c0-1.65 1.35-3 3-3h9.17l-1.58 1.59L17 12l4-4-4-4z"/></svg>';
    if (text.includes('ramp') || text.includes('exit') || text.includes('off-ramp')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M18 6.83l1.59 1.58L21 7l-4-4-4 4 1.41 1.41L16 6.83V10c0 3.07-1.64 5.64-4 7.08V4h-2v13.08C7.64 15.64 6 13.07 6 10V6.83L7.59 8.41 9 7 5 3 1 7l1.41 1.41L4 6.83V10c0 3.72 2.01 6.94 5 8.72V21h6v-2.28c2.99-1.78 5-5 5-8.72V6.83z"/></svg>';
    if (text.includes('fork')) return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M14 7l5 5-5 5V7zM3 17v2h18v-2H3zM10 7v10l-5-5 5-5z"/></svg>';
    return '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#5f6368" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
}

function initTimelineDrag() {
    const container = timelineCards;
    let isDown = false, startX, scrollLeft;
    container.addEventListener('mousedown', (e) => { isDown = true; container.classList.add('dragging'); startX = e.pageX - container.offsetLeft; scrollLeft = container.scrollLeft; });
    container.addEventListener('mouseleave', () => { isDown = false; container.classList.remove('dragging'); });
    container.addEventListener('mouseup', () => { isDown = false; container.classList.remove('dragging'); });
    container.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); container.scrollLeft = scrollLeft - (e.pageX - container.offsetLeft - startX); });
}

function formatDuration(seconds) {
    const totalMin = Math.round(seconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} hr`;
    return `${h} hr ${m} min`;
}

// ===== LIVE GPS NAVIGATION =====

function startNavigation() {
    if (!currentDirectionsResult || !currentRouteData) return;
    if (!navigator.geolocation) { showError('Geolocation not supported by your browser.'); return; }

    const selectedRouteEl = document.querySelector('.route-option.selected');
    const selectedIdx = selectedRouteEl ? [...document.querySelectorAll('.route-option')].indexOf(selectedRouteEl) : 0;
    const rd = currentRouteData[selectedIdx];
    navRoute = currentDirectionsResult.routes[rd.routeIndex];

    const allSteps = [];
    navTotalDist = 0;
    for (const leg of navRoute.legs) {
        for (const step of leg.steps) {
            allSteps.push(step);
            navTotalDist += step.distance ? step.distance.value : 0;
        }
    }
    navSteps = allSteps;
    navCurrentStep = 0;
    navActive = true;
    navFollowing = true;
    navStartTime = Date.now();
    navLastAlertStep = -1;
    navUserDragged = false;

    document.getElementById('side-panel').style.display = 'none';
    weatherTimeline.classList.add('hidden');
    document.getElementById('show-full-trip').classList.add('hidden');
    navOverlay.classList.remove('hidden');
    document.getElementById('nav-arrived').classList.add('hidden');
    document.getElementById('nav-steps-drawer').classList.add('hidden');
    document.getElementById('nav-recenter-btn').classList.add('hidden');
    document.getElementById('nav-progress-fill').style.width = '0%';
    document.getElementById('nav-weather-alert').classList.add('hidden');

    navRadarWasOn = !!radarLayer;
    if (!radarLayer) enableRadar();

    weatherOverlays.forEach(o => o.setMap(null));
    routeInfoOverlays.forEach(o => o.setMap(null));
    directionsRenderers.forEach(r => r.setMap(null));

    navRenderer = new google.maps.DirectionsRenderer({
        map,
        directions: currentDirectionsResult,
        routeIndex: rd.routeIndex,
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: { strokeColor: '#4285f4', strokeWeight: 7, strokeOpacity: 0.85, zIndex: 10 }
    });

    map.setZoom(17);
    map.setTilt(45);

    map.addListener('dragstart', onNavMapDrag);

    updateNavUI();
    buildNavStepsList();

    navWatchId = navigator.geolocation.watchPosition(
        (pos) => onNavPositionUpdate(pos),
        () => {
            document.getElementById('nav-instruction').textContent = 'GPS signal lost. Trying to reconnect...';
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
    );

    fetchNavWeather();
    navWeatherInterval = setInterval(() => fetchNavWeather(), 120000);

    acquireWakeLock();

    document.getElementById('nav-steps-btn').addEventListener('click', toggleNavStepsDrawer);
    document.getElementById('nav-steps-close').addEventListener('click', () => {
        document.getElementById('nav-steps-drawer').classList.add('hidden');
    });
    document.getElementById('nav-recenter-btn').addEventListener('click', navRecenter);
    document.getElementById('nav-arrived-close').addEventListener('click', stopNavigation);

    const muteBtn = document.getElementById('nav-mute-btn');
    navMuted = false;
    muteBtn.classList.remove('muted');
    muteBtn.onclick = () => {
        navMuted = !navMuted;
        muteBtn.classList.toggle('muted', navMuted);
        muteBtn.querySelector('svg').innerHTML = navMuted
            ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
            : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    };

    try { navAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}

function onNavMapDrag() {
    if (!navActive) return;
    navFollowing = false;
    navUserDragged = true;
    document.getElementById('nav-recenter-btn').classList.remove('hidden');
}

function navRecenter() {
    navFollowing = true;
    navUserDragged = false;
    document.getElementById('nav-recenter-btn').classList.add('hidden');
    if (navMarker) {
        map.panTo(navMarker.getPosition());
        map.setZoom(17);
        map.setTilt(45);
        if (navLastHeading) map.setHeading(navLastHeading);
    }
}

async function acquireWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            navWakeLock = await navigator.wakeLock.request('screen');
        }
    } catch {}
}

function releaseWakeLock() {
    if (navWakeLock) {
        navWakeLock.release().catch(() => {});
        navWakeLock = null;
    }
}

function stopNavigation() {
    navActive = false;
    if (navWatchId !== null) {
        navigator.geolocation.clearWatch(navWatchId);
        navWatchId = null;
    }
    if (navMarker) { navMarker.setMap(null); navMarker = null; }
    if (navRenderer) { navRenderer.setMap(null); navRenderer = null; }
    if (navWeatherInterval) { clearInterval(navWeatherInterval); navWeatherInterval = null; }
    if (navAlertTimeout) { clearTimeout(navAlertTimeout); navAlertTimeout = null; }
    if (navWeatherAlertTimeout) { clearTimeout(navWeatherAlertTimeout); navWeatherAlertTimeout = null; }
    releaseWakeLock();

    if (!navRadarWasOn) disableRadar();
    document.getElementById('toggle-radar').checked = !!radarLayer;

    navOverlay.classList.add('hidden');
    document.getElementById('nav-weather-strip').classList.add('hidden');
    document.getElementById('nav-weather-alert').classList.add('hidden');
    document.getElementById('nav-steps-drawer').classList.add('hidden');
    document.getElementById('nav-arrived').classList.add('hidden');
    document.getElementById('side-panel').style.display = '';

    map.setTilt(0);
    map.setHeading(0);

    if (currentDirectionsResult && currentRouteData) {
        displayRoutes(currentDirectionsResult, currentRouteData, getDepartureTime());
    }
}

function onNavPositionUpdate(pos) {
    if (!navActive) return;
    const userLat = pos.coords.latitude;
    const userLng = pos.coords.longitude;
    const userPos = new google.maps.LatLng(userLat, userLng);
    const speedMph = pos.coords.speed != null && pos.coords.speed >= 0 ? Math.round(pos.coords.speed * 2.237) : 0;
    const heading = pos.coords.heading;

    if (heading != null && !isNaN(heading)) {
        navLastHeading = heading;
    }

    if (!navMarker) {
        navMarker = new google.maps.Marker({
            position: userPos,
            map,
            icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 7,
                fillColor: '#4285f4',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2.5,
                rotation: navLastHeading
            },
            zIndex: 1000
        });
    } else {
        navMarker.setPosition(userPos);
        navMarker.setIcon({
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 7,
            fillColor: '#4285f4',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2.5,
            rotation: navLastHeading
        });
    }

    if (navFollowing) {
        map.panTo(userPos);
        if (map.getZoom() < 16) map.setZoom(17);
        map.setTilt(45);
        if (navLastHeading) map.setHeading(navLastHeading);
    }

    advanceStep(userPos);
    checkOffRoute(userPos);

    document.getElementById('nav-speedo-value').textContent = speedMph;

    let remainDist = 0, remainTime = 0;
    for (let i = navCurrentStep; i < navSteps.length; i++) {
        remainDist += navSteps[i].distance ? navSteps[i].distance.value : 0;
        remainTime += navSteps[i].duration ? navSteps[i].duration.value : 0;
    }

    const distToNextEnd = estimateDistance(
        userLat, userLng,
        navSteps[navCurrentStep].end_location.lat(),
        navSteps[navCurrentStep].end_location.lng()
    );
    const stepDist = navSteps[navCurrentStep].distance ? navSteps[navCurrentStep].distance.value : 0;
    const adjustedRemain = remainDist - stepDist + distToNextEnd;

    const progressPct = navTotalDist > 0 ? Math.min(100, ((navTotalDist - adjustedRemain) / navTotalDist) * 100) : 0;
    document.getElementById('nav-progress-fill').style.width = progressPct + '%';

    const remainMiles = (adjustedRemain / 1609.34);
    document.getElementById('nav-remaining-dist').textContent = remainMiles >= 10 ? Math.round(remainMiles) + ' mi' : remainMiles.toFixed(1) + ' mi';
    document.getElementById('nav-remaining-time').textContent = formatDuration(remainTime);

    const eta = new Date(Date.now() + remainTime * 1000);
    document.getElementById('nav-eta').textContent = eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    updateNavDistanceToTurn(userLat, userLng);
    updateNavUI();
    updateNavStepsList();
}

function updateNavDistanceToTurn(userLat, userLng) {
    if (navCurrentStep >= navSteps.length) return;
    const step = navSteps[navCurrentStep];
    const endLoc = step.end_location;
    const distM = estimateDistance(userLat, userLng, endLoc.lat(), endLoc.lng());
    const distEl = document.getElementById('nav-distance-next');

    if (distM < 30) {
        distEl.textContent = 'Now';
    } else if (distM < 161) {
        distEl.textContent = Math.round(distM) + ' m';
    } else if (distM < 1609) {
        distEl.textContent = Math.round(distM * 3.281) + ' ft';
    } else {
        const mi = distM / 1609.34;
        distEl.textContent = mi >= 10 ? Math.round(mi) + ' mi' : mi.toFixed(1) + ' mi';
    }

    if (distM < 200 && navCurrentStep !== navLastAlertStep) {
        showTurnAlert(step);
        navLastAlertStep = navCurrentStep;
    }
}

function showTurnAlert(step) {
    const alertEl = document.getElementById('nav-alert');
    const text = (step.maneuver || '' + ' ' + step.instructions || '').toLowerCase();
    let icon = '↗️';
    if (text.includes('left')) icon = '⬅️';
    else if (text.includes('right')) icon = '➡️';
    else if (text.includes('uturn') || text.includes('u-turn')) icon = '↩️';
    else if (text.includes('roundabout')) icon = '🔄';

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = step.instructions;
    const cleanText = tempDiv.textContent;

    document.getElementById('nav-alert-icon').textContent = icon;
    document.getElementById('nav-alert-text').textContent = cleanText.length > 40 ? cleanText.substring(0, 40) + '...' : cleanText;
    alertEl.classList.remove('hidden');

    if (!navMuted) {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        playNavBeep();
    }

    if (navAlertTimeout) clearTimeout(navAlertTimeout);
    navAlertTimeout = setTimeout(() => {
        alertEl.classList.add('hidden');
    }, 3000);
}

function playNavBeep() {
    if (!navAudioCtx || navMuted) return;
    try {
        const osc = navAudioCtx.createOscillator();
        const gain = navAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(navAudioCtx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, navAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, navAudioCtx.currentTime + 0.3);
        osc.start(navAudioCtx.currentTime);
        osc.stop(navAudioCtx.currentTime + 0.3);
    } catch {}
}

function advanceStep(userPos) {
    if (navCurrentStep >= navSteps.length - 1) {
        showArrival();
        return;
    }

    const stepEnd = navSteps[navCurrentStep].end_location;
    const distToEnd = estimateDistance(
        userPos.lat(), userPos.lng(),
        stepEnd.lat(), stepEnd.lng()
    );

    if (distToEnd < 25) {
        navCurrentStep++;
        if (navCurrentStep >= navSteps.length - 1) {
            const finalEnd = navSteps[navSteps.length - 1].end_location;
            const distToFinal = estimateDistance(userPos.lat(), userPos.lng(), finalEnd.lat(), finalEnd.lng());
            if (distToFinal < 50) {
                showArrival();
            }
        }
    }
}

function showArrival() {
    const arrivedEl = document.getElementById('nav-arrived');
    const lastLeg = navRoute.legs[navRoute.legs.length - 1];
    const elapsed = Date.now() - navStartTime;

    document.getElementById('nav-arrived-address').textContent = lastLeg.end_address;
    document.getElementById('nav-arrived-stats').innerHTML = `
        <span>⏱ ${formatDuration(Math.round(elapsed / 1000))}</span>
        <span>📏 ${(navTotalDist / 1609.34).toFixed(1)} mi</span>
    `;
    arrivedEl.classList.remove('hidden');
}

function checkOffRoute(userPos) {
    if (navCurrentStep >= navSteps.length) return;
    const step = navSteps[navCurrentStep];
    const distToStart = estimateDistance(
        userPos.lat(), userPos.lng(),
        step.start_location.lat(), step.start_location.lng()
    );
    const distToEnd = estimateDistance(
        userPos.lat(), userPos.lng(),
        step.end_location.lat(), step.end_location.lng()
    );
    const stepLen = step.distance ? step.distance.value : 0;
    const topBar = document.getElementById('nav-top-bar');

    if (distToStart > stepLen + 200 && distToEnd > stepLen + 200 && stepLen > 0) {
        topBar.classList.add('nav-rerouting');
        document.getElementById('nav-instruction').textContent = 'Rerouting...';
        document.getElementById('nav-distance-next').textContent = '📡';
        reroute(userPos);
    } else {
        topBar.classList.remove('nav-rerouting');
    }
}

let rerouteDebounce = null;
function reroute(userPos) {
    if (rerouteDebounce) return;
    rerouteDebounce = setTimeout(async () => {
        rerouteDebounce = null;
        if (!navActive) return;
        try {
            const lastLeg = navRoute.legs[navRoute.legs.length - 1];
            const dest = lastLeg.end_address;
            const origin = `${userPos.lat()},${userPos.lng()}`;
            const result = await getRoute(origin, dest, []);
            if (!navActive) return;

            navRoute = result.routes[0];
            const allSteps = [];
            navTotalDist = 0;
            for (const leg of navRoute.legs) {
                for (const step of leg.steps) {
                    allSteps.push(step);
                    navTotalDist += step.distance ? step.distance.value : 0;
                }
            }
            navSteps = allSteps;
            navCurrentStep = 0;

            if (navRenderer) navRenderer.setMap(null);
            navRenderer = new google.maps.DirectionsRenderer({
                map,
                directions: result,
                routeIndex: 0,
                suppressMarkers: true,
                preserveViewport: true,
                polylineOptions: { strokeColor: '#4285f4', strokeWeight: 7, strokeOpacity: 0.85, zIndex: 10 }
            });

            document.getElementById('nav-top-bar').classList.remove('nav-rerouting');
            buildNavStepsList();
            updateNavUI();
        } catch {}
    }, 3000);
}

function updateNavUI() {
    if (navCurrentStep >= navSteps.length) return;
    const step = navSteps[navCurrentStep];
    const instrEl = document.getElementById('nav-instruction');

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = step.instructions;
    instrEl.textContent = tempDiv.textContent;

    const roadName = extractRoadName(step.instructions);
    document.getElementById('nav-road-name').textContent = roadName;

    const icon = getNavManeuverSVG(step.maneuver || '', step.instructions || '');
    document.getElementById('nav-maneuver-icon').innerHTML = icon;

    const nextStepEl = document.getElementById('nav-next-step');
    if (navCurrentStep + 1 < navSteps.length) {
        const next = navSteps[navCurrentStep + 1];
        const nextIcon = getNavManeuverSVG(next.maneuver || '', next.instructions || '');
        const nextTemp = document.createElement('div');
        nextTemp.innerHTML = next.instructions;
        const dist = next.distance ? next.distance.text : '';
        document.getElementById('nav-next-icon').innerHTML = nextIcon.replace('width="36" height="36"', 'width="18" height="18"');
        document.getElementById('nav-next-text').textContent = `Then ${dist ? dist + ' · ' : ''}${nextTemp.textContent}`;
        nextStepEl.classList.remove('hidden');
    } else {
        nextStepEl.classList.add('hidden');
    }
}

function buildNavStepsList() {
    const list = document.getElementById('nav-steps-list');
    list.innerHTML = '';
    navSteps.forEach((step, i) => {
        const item = document.createElement('div');
        item.className = 'nav-step-item' + (i === navCurrentStep ? ' active' : '') + (i < navCurrentStep ? ' completed' : '');
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = step.instructions;
        item.innerHTML = `
            <div class="nav-step-num">${i + 1}</div>
            <div class="nav-step-text">${tempDiv.textContent}</div>
            <div class="nav-step-dist">${step.distance ? step.distance.text : ''}</div>
        `;
        list.appendChild(item);
    });
}

function updateNavStepsList() {
    const items = document.querySelectorAll('.nav-step-item');
    items.forEach((item, i) => {
        item.className = 'nav-step-item' + (i === navCurrentStep ? ' active' : '') + (i < navCurrentStep ? ' completed' : '');
    });
    const activeItem = document.querySelector('.nav-step-item.active');
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function toggleNavStepsDrawer() {
    const drawer = document.getElementById('nav-steps-drawer');
    drawer.classList.toggle('hidden');
    if (!drawer.classList.contains('hidden')) {
        buildNavStepsList();
    }
}

function getNavManeuverSVG(maneuver, instructions) {
    const text = (maneuver + ' ' + instructions).toLowerCase();
    if (text.includes('uturn') || text.includes('u-turn')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M18 9v12h-2V9c0-2.21-1.79-4-4-4S8 6.79 8 9v4.17l1.59-1.59L11 13l-4 4-4-4 1.41-1.41L6 13.17V9c0-3.31 2.69-6 6-6s6 2.69 6 6z"/></svg>';
    if (text.includes('sharp-left') || text.includes('sharp left')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M6 6.83L4.41 8.41 3 7l4-4 4 4-1.41 1.41L8 6.83V13h8c1.1 0 2 .9 2 2v6h-2v-6H8c-1.1 0-2-.9-2-2V6.83z"/></svg>';
    if (text.includes('sharp-right') || text.includes('sharp right')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M18 6.83l-1.59 1.58L15 7l4-4 4 4-1.41 1.41L20 6.83V13h-8c-1.1 0-2 .9-2 2v6H8v-6c0-1.1-.9-2-2-2h8V6.83z"/></svg>';
    if (text.includes('turn-left') || text.includes('turn left') || text.includes('left')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M14 7l-5 5 5 5V7z"/></svg>';
    if (text.includes('turn-right') || text.includes('turn right') || text.includes('right')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M10 17l5-5-5-5v10z"/></svg>';
    if (text.includes('roundabout')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/></svg>';
    if (text.includes('merge')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M17 4l-1.41 1.41L17.17 7H8c-2.76 0-5 2.24-5 5v5h2v-5c0-1.65 1.35-3 3-3h9.17l-1.58 1.59L17 12l4-4-4-4z"/></svg>';
    if (text.includes('ramp') || text.includes('exit') || text.includes('off-ramp')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M18 6.83l1.59 1.58L21 7l-4-4-4 4 1.41 1.41L16 6.83V10c0 3.07-1.64 5.64-4 7.08V4h-2v13.08C7.64 15.64 6 13.07 6 10V6.83L7.59 8.41 9 7 5 3 1 7l1.41 1.41L4 6.83V10c0 3.72 2.01 6.94 5 8.72V21h6v-2.28c2.99-1.78 5-5 5-8.72V6.83z"/></svg>';
    if (text.includes('fork')) return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M14 7l5 5-5 5V7zM3 17v2h18v-2H3zM10 7v10l-5-5 5-5z"/></svg>';
    return '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="white" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
}

function estimateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractRoadName(instructions) {
    if (!instructions) return '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = instructions;
    const bTags = tempDiv.querySelectorAll('b');
    if (bTags.length > 0) {
        const last = bTags[bTags.length - 1].textContent;
        if (last && last.length > 1) return last;
    }
    return '';
}

async function fetchNavWeather() {
    if (!navActive) return;
    const loc = navMarker ? navMarker.getPosition() : (navRoute ? navRoute.legs[0].start_location : null);
    if (!loc) return;
    try {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
        const hour = now.getHours();
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat()}&longitude=${loc.lng()}&hourly=temperature_2m,weathercode,windspeed_10m,precipitation_probability,precipitation&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&start_date=${dateStr}&end_date=${tomorrow}`);
        const data = await res.json();
        if (data.hourly && data.hourly.temperature_2m) {
            const h = Math.min(hour, data.hourly.time.length - 1);
            const temp = Math.round(data.hourly.temperature_2m[h]);
            const code = data.hourly.weathercode[h];
            const wind = data.hourly.windspeed_10m ? Math.round(data.hourly.windspeed_10m[h]) : null;
            const info = weatherCodeToInfo(code);
            const strip = document.getElementById('nav-weather-strip');
            document.getElementById('nav-weather-icon').textContent = info.icon;
            document.getElementById('nav-weather-temp').textContent = temp + '°F';
            document.getElementById('nav-weather-desc').textContent = info.desc;
            document.getElementById('nav-weather-wind').textContent = wind ? `💨 ${wind} mph` : '';
            strip.classList.remove('hidden');

            showWeatherPrediction(data.hourly, hour, code);
        }
    } catch {}
}

function showWeatherPrediction(hourly, currentHour, currentCode) {
    const alertEl = document.getElementById('nav-weather-alert');
    const iconEl = document.getElementById('nav-weather-alert-icon');
    const textEl = document.getElementById('nav-weather-alert-text');

    const rainCodes = [51, 53, 55, 61, 63, 65, 80, 81, 82];
    const snowCodes = [66, 67, 71, 73, 75, 77, 85, 86];
    const stormCodes = [95, 96, 99];
    const precipCodes = [...rainCodes, ...snowCodes, ...stormCodes];

    const currentIsRaining = precipCodes.includes(currentCode);
    const lookAheadHours = 6;

    if (currentIsRaining) {
        let clearInHours = null;
        for (let i = currentHour + 1; i < Math.min(currentHour + lookAheadHours, hourly.weathercode.length); i++) {
            if (!precipCodes.includes(hourly.weathercode[i])) {
                clearInHours = i - currentHour;
                break;
            }
        }

        const cat = stormCodes.includes(currentCode) ? 'storm' : snowCodes.includes(currentCode) ? 'snow' : 'rain';
        alertEl.className = 'alert-' + cat;

        if (clearInHours) {
            const mins = clearInHours * 60;
            iconEl.textContent = cat === 'storm' ? '⚡' : cat === 'snow' ? '🌨️' : '🌧️';
            textEl.textContent = mins <= 60
                ? `${cat === 'storm' ? 'Storm' : cat === 'snow' ? 'Snow' : 'Rain'} clearing in ~${mins} min`
                : `${cat === 'storm' ? 'Storm' : cat === 'snow' ? 'Snow' : 'Rain'} clearing in ~${clearInHours} hr`;
        } else {
            iconEl.textContent = cat === 'storm' ? '⚡' : cat === 'snow' ? '🌨️' : '🌧️';
            textEl.textContent = `${cat === 'storm' ? 'Storm' : cat === 'snow' ? 'Snow' : 'Rain'} continuing`;
        }
        alertEl.classList.remove('hidden');
    } else {
        let precipStartHour = null;
        let precipType = 'rain';
        for (let i = currentHour + 1; i < Math.min(currentHour + lookAheadHours, hourly.weathercode.length); i++) {
            const fc = hourly.weathercode[i];
            if (precipCodes.includes(fc)) {
                precipStartHour = i;
                precipType = stormCodes.includes(fc) ? 'storm' : snowCodes.includes(fc) ? 'snow' : 'rain';
                break;
            }
        }

        if (precipStartHour) {
            const minsUntil = (precipStartHour - currentHour) * 60;
            alertEl.className = 'alert-' + precipType;

            iconEl.textContent = precipType === 'storm' ? '⚡' : precipType === 'snow' ? '🌨️' : '🌧️';
            textEl.textContent = minsUntil <= 60
                ? `${precipType === 'storm' ? 'Storm' : precipType === 'snow' ? 'Snow' : 'Rain'} starting in ~${minsUntil} min`
                : `${precipType === 'storm' ? 'Storm' : precipType === 'snow' ? 'Snow' : 'Rain'} in ~${Math.round(minsUntil / 60)} hr`;
            alertEl.classList.remove('hidden');
        } else {
            const highPrecipProb = hourly.precipitation_probability;
            if (highPrecipProb) {
                let highProbHour = null;
                for (let i = currentHour + 1; i < Math.min(currentHour + lookAheadHours, highPrecipProb.length); i++) {
                    if (highPrecipProb[i] >= 60) { highProbHour = i; break; }
                }
                if (highProbHour) {
                    const minsUntil = (highProbHour - currentHour) * 60;
                    alertEl.className = 'alert-rain';
                    iconEl.textContent = '🌦️';
                    textEl.textContent = minsUntil <= 60
                        ? `${highPrecipProb[highProbHour]}% chance of rain in ~${minsUntil} min`
                        : `${highPrecipProb[highProbHour]}% chance of rain in ~${Math.round(minsUntil / 60)} hr`;
                    alertEl.classList.remove('hidden');
                } else {
                    alertEl.className = 'alert-clear';
                    iconEl.textContent = '☀️';
                    textEl.textContent = 'Clear weather ahead';
                    alertEl.classList.remove('hidden');
                    if (navWeatherAlertTimeout) clearTimeout(navWeatherAlertTimeout);
                    navWeatherAlertTimeout = setTimeout(() => alertEl.classList.add('hidden'), 8000);
                    return;
                }
            } else {
                alertEl.classList.add('hidden');
            }
        }
    }

    if (navWeatherAlertTimeout) clearTimeout(navWeatherAlertTimeout);
    navWeatherAlertTimeout = setTimeout(() => alertEl.classList.add('hidden'), 15000);
}

function showError(msg) { errorMessage.textContent = msg; errorMessage.classList.remove('hidden'); }
function hideError() { errorMessage.classList.add('hidden'); }
