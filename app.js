const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
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
const waypointsContainer = document.getElementById('waypoints-container');
const directionsPanel = document.getElementById('directions-panel');
const recentSearchesDiv = document.getElementById('recent-searches');
const recentList = document.getElementById('recent-list');
const shareTripBtn = document.getElementById('share-trip-btn');
const printTripBtn = document.getElementById('print-trip-btn');
const departureSlider = document.getElementById('departure-slider');
const sliderTimeLabel = document.getElementById('slider-time-label');

let map = null;
let directionsRenderers = [];
let weatherOverlays = [];
let routeInfoOverlays = [];
let radarLayer = null;
let WeatherOverlay = null;
let RouteInfoOverlay = null;
let lastRouteBounds = null;
let showOverlaysFlag = true;
let currentWeatherData = null;
let currentRouteData = null;
let currentDirectionsResult = null;
let mapClickMode = null;
let pickMarker = null;
let myLocationMarker = null;
let waypointInputs = [];

const now = new Date();
departureDateInput.value = now.toISOString().split('T')[0];
departureDateInput.min = now.toISOString().split('T')[0];
departureTimeInput.value = now.toTimeString().slice(0, 5);
departureSlider.value = now.getHours();
const _h = now.getHours(), _ampm = _h < 12 ? 'AM' : 'PM', _h12 = _h === 0 ? 12 : _h > 12 ? _h - 12 : _h;
sliderTimeLabel.textContent = `${_h12}:00 ${_ampm}`;

loadRecentSearches();

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

        myLocationBtn.addEventListener('click', () => {
            if (!navigator.geolocation) { showError('Geolocation not supported.'); return; }
            myLocationBtn.style.opacity = '0.5';
            navigator.geolocation.getCurrentPosition(pos => {
                const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                if (myLocationMarker) myLocationMarker.setMap(null);
                myLocationMarker = new google.maps.Marker({
                    position: latlng, map,
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#4285F4', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
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
            if (!mapClickMode) return;
            const latlng = e.latLng;
            if (pickMarker) pickMarker.setMap(null);
            pickMarker = new google.maps.Marker({
                position: latlng, map,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#ffffff', fillOpacity: 1, strokeColor: mapClickMode === 'origin' ? '#5f6368' : '#4285f4', strokeWeight: 3 },
                animation: google.maps.Animation.DROP
            });
            let targetInput;
            if (mapClickMode === 'origin') targetInput = originInput;
            else if (mapClickMode === 'destination') targetInput = destinationInput;
            else targetInput = document.getElementById(mapClickMode);
            if (!targetInput) return;
            targetInput.value = 'Loading address...';
            targetInput.classList.add('chosen');
            new google.maps.Geocoder().geocode({ location: latlng }, (results, status) => {
                targetInput.value = (status === 'OK' && results[0]) ? results[0].formatted_address : `${latlng.lat().toFixed(6)}, ${latlng.lng().toFixed(6)}`;
                setTimeout(() => targetInput.classList.remove('chosen'), 1500);
                mapClickMode = null;
                map.setOptions({ draggableCursor: null });
                document.querySelectorAll('.picking').forEach(el => el.classList.remove('picking'));
            });
        });

        originInput.addEventListener('focus', () => { setPickMode('origin', originInput); });
        destinationInput.addEventListener('focus', () => { setPickMode('destination', destinationInput); });

        planButton.addEventListener('click', () => {
            mapClickMode = null;
            map.setOptions({ draggableCursor: null });
            document.querySelectorAll('.picking').forEach(el => el.classList.remove('picking'));
            planTrip();
        });

        document.getElementById('toggle-overlays').addEventListener('change', (e) => {
            showOverlaysFlag = e.target.checked;
            if (showOverlaysFlag && currentWeatherData) showOverlaysOnMap(currentWeatherData);
            else { weatherOverlays.forEach(o => o.setMap(null)); weatherOverlays = []; }
        });

        document.getElementById('toggle-radar').addEventListener('change', (e) => {
            if (e.target.checked) {
                radarLayer = new google.maps.ImageMapType({
                    getTileUrl: (coord, zoom) => `https://tilecache.rainviewer.com/v2/radar/nowcast/256/${zoom}/${coord.x}/${coord.y}/6/1_1.png`,
                    tileSize: new google.maps.Size(256, 256),
                    opacity: 0.5,
                    name: 'Radar'
                });
                map.overlayMapTypes.push(radarLayer);
            } else {
                for (let i = map.overlayMapTypes.getLength() - 1; i >= 0; i--) {
                    if (map.overlayMapTypes.getAt(i) === radarLayer) map.overlayMapTypes.removeAt(i);
                }
                radarLayer = null;
            }
        });

        addWaypointBtn.addEventListener('click', addWaypoint);
        shareTripBtn.addEventListener('click', shareTrip);
        printTripBtn.addEventListener('click', printTrip);

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

        initTimelineDrag();
    } catch (err) {
        showError('Google Maps failed to initialize: ' + err.message);
    }
}
window.initApp = initApp;

function setPickMode(mode, inputEl) {
    mapClickMode = mode;
    map.setOptions({ draggableCursor: 'crosshair' });
    document.querySelectorAll('.picking').forEach(el => el.classList.remove('picking'));
    inputEl.classList.add('picking');
}

function addWaypoint() {
    const id = 'waypoint-' + waypointInputs.length;
    const row = document.createElement('div');
    row.className = 'search-input-row waypoint-row';
    row.innerHTML = `
        <div class="input-dot-wrap"><span class="dot waypoint-dot"></span><span class="dot-line"></span></div>
        <input type="text" id="${id}" placeholder="Add a stop..." autocomplete="off" />
        <button class="remove-waypoint" title="Remove stop">&times;</button>
    `;
    waypointsContainer.appendChild(row);
    const input = row.querySelector('input');
    waypointInputs.push(input);
    const sb = new google.maps.places.SearchBox(input);
    map.addListener('bounds_changed', () => sb.setBounds(map.getBounds()));
    input.addEventListener('focus', () => setPickMode(id, input));
    row.querySelector('.remove-waypoint').addEventListener('click', () => {
        row.remove();
        waypointInputs = waypointInputs.filter(w => w !== input);
    });
}

function clearMap() {
    weatherOverlays.forEach(o => o.setMap(null)); weatherOverlays = [];
    directionsRenderers.forEach(r => r.setMap(null)); directionsRenderers = [];
    routeInfoOverlays.forEach(o => o.setMap(null)); routeInfoOverlays = [];
    if (pickMarker) { pickMarker.setMap(null); pickMarker = null; }
    directionsPanel.innerHTML = ''; directionsPanel.classList.add('hidden');
}

async function planTrip() {
    hideError();
    if (!originInput.value.trim()) { showError('Please enter a starting point.'); return; }
    if (!destinationInput.value.trim()) { showError('Please enter a destination.'); return; }
    if (!departureDateInput.value) { showError('Please select a departure date.'); return; }

    saveRecentSearch(originInput.value, destinationInput.value);

    planButton.disabled = true;
    planButton.textContent = 'Searching...';
    routesSection.classList.remove('hidden');
    routesList.innerHTML = '<div class="loading">Finding routes...</div>';
    weatherTimeline.classList.add('hidden');

    try {
        const waypoints = waypointInputs.filter(w => w.value.trim()).map(w => ({ location: w.value.trim(), stopover: true }));
        const result = await getRoute(originInput.value, destinationInput.value, waypoints);
        const departureTime = new Date(`${departureDateInput.value}T${departureTimeInput.value}:00`);

        routesList.innerHTML = '<div class="loading">Loading weather...</div>';

        const maxRoutes = Math.min(result.routes.length, 3);
        const allWaypoints = [];
        for (let r = 0; r < maxRoutes; r++) allWaypoints.push(sampleWaypoints(result, r, departureTime));
        const allWeather = await Promise.all(allWaypoints.map(wp => getWeatherForWaypoints(wp)));

        const routeData = [];
        for (let r = 0; r < maxRoutes; r++) {
            const weatherData = allWeather[r];
            const withForecast = weatherData.filter(w => !w.noForecast);
            const maxRain = withForecast.length ? Math.max(...withForecast.map(w => w.precipitationProb)) : 0;
            const badWeatherCount = withForecast.filter(w =>
                [55, 61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82, 85, 86, 95, 96, 99].includes(w.weatherCode)
            ).length;
            const alerts = getWeatherAlerts(weatherData);
            const roadConditions = getRoadConditions(weatherData);
            const score = calcRouteScore(weatherData);
            const route = result.routes[r];
            const leg = route.legs[0];
            const duration = (leg.duration_in_traffic || leg.duration).value;
            routeData.push({ routeIndex: r, weatherData, maxRain, badWeatherCount, alerts, roadConditions, score, duration });
        }

        const fastestIdx = routeData.reduce((min, rd, i) => rd.duration < routeData[min].duration ? i : min, 0);
        const bestWeatherIdx = routeData.reduce((best, rd, i) => rd.score > routeData[best].score ? i : best, 0);
        routeData.forEach((rd, i) => { rd.isFastest = i === fastestIdx; rd.isBestWeather = i === bestWeatherIdx; });

        currentDirectionsResult = result;
        currentRouteData = routeData;
        displayRoutes(result, routeData, departureTime);

    } catch (err) {
        showError('Could not find a route: ' + err.message);
        routesList.innerHTML = '';
    } finally {
        planButton.disabled = false;
        planButton.textContent = 'Search';
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
            conditions.push({ type: 'warning', icon: '💨', text: `Dangerous crosswinds near ${wp.locationName}` });
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
                polylineOptions: { strokeColor: isSelected ? '#4285F4' : '#8AB4F8', strokeWeight: isSelected ? 5 : 4, strokeOpacity: isSelected ? 1.0 : 0.7, zIndex: isSelected ? 10 : 1 }
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
        if (showOverlaysFlag) showOverlaysOnMap(rd.weatherData);
        showDirections(directionsResult, rd.routeIndex);
    }

    routeData.forEach((rd, idx) => {
        const route = directionsResult.routes[rd.routeIndex];
        const leg = route.legs[0];
        const durationText = formatDuration((leg.duration_in_traffic || leg.duration).value);
        const baseDurationText = formatDuration(leg.duration.value);
        const distMiles = Math.round(leg.distance.value / 1609.34);
        const summary = route.summary || `Route ${idx + 1}`;
        const { barHtml: weatherBarHtml, iconsHtml: weatherIconsHtml } = buildWeatherBar(rd.weatherData);
        const traffic = getStepTrafficSegments(route);
        const trafficBarHtml = traffic.segments.map(s => `<div style="flex:${s.pct};background:${s.color};height:100%;"></div>`).join('');

        let badgesHtml = `<span class="badge badge-score">Score: ${rd.score}/10</span>`;
        if (rd.isFastest && routeData.length > 1) badgesHtml += '<span class="badge badge-fastest">Fastest</span>';
        if (rd.isBestWeather && routeData.length > 1) badgesHtml += '<span class="badge badge-best-weather">Best weather</span>';
        if (rd.badWeatherCount > 0) badgesHtml += `<span class="badge badge-bad-weather">${rd.badWeatherCount} bad stretch${rd.badWeatherCount > 1 ? 'es' : ''}</span>`;

        let conditionsHtml = '';
        const allConditions = [...rd.roadConditions, ...rd.alerts];
        if (allConditions.length > 0) {
            conditionsHtml = '<div class="route-alerts-compact">' + allConditions.slice(0, 4).map(a => {
                const cls = a.type === 'danger' ? 'danger' : a.type === 'warning' ? 'warning' : 'caution';
                return `<div class="alert-inline ${cls}">${a.icon} ${a.text}</div>`;
            }).join('') + '</div>';
        }

        const sunInfo = getSunriseSunset(rd.weatherData);

        const btn = document.createElement('button');
        btn.className = `route-option ${idx === 0 ? 'selected' : ''}`;
        btn.innerHTML = `
            <div class="route-option-header">
                <span class="route-name">via ${summary}</span>
                <span class="route-duration">${durationText}</span>
            </div>
            <div class="route-meta">${baseDurationText} without traffic · ${distMiles} miles${sunInfo ? ` · ${sunInfo}` : ''}</div>
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
    map.fitBounds(bounds, { top: 20, left: 420, right: 40, bottom: 200 });
}

function getSunriseSunset(weatherData) {
    if (!weatherData.length) return '';
    const start = weatherData[0].arrivalTime;
    const end = weatherData[weatherData.length - 1].arrivalTime;
    const startH = start.getHours();
    const endH = end.getHours();
    const parts = [];
    if (startH < 6 || startH >= 20) parts.push('🌙 Starts in dark');
    if (endH < 6 || endH >= 20) parts.push('🌙 Arrives in dark');
    const drivingHours = (end - start) / 3600000;
    if (drivingHours > 4) {
        if (startH < 18 && endH >= 20) parts.push('🌅 Sunset during drive');
        if (startH < 6 && endH >= 6) parts.push('🌄 Sunrise during drive');
        if (startH >= 6 && startH < 20 && endH >= 20) parts.push('🌅 Sunset during drive');
    }
    return parts.join(' · ');
}

function showDirections(directionsResult, routeIndex) {
    directionsPanel.classList.remove('hidden');
    directionsPanel.innerHTML = '';
    const route = directionsResult.routes[routeIndex];
    const leg = route.legs[0];

    const header = document.createElement('div');
    header.className = 'directions-header';
    header.innerHTML = `<div class="dir-endpoints"><strong>${leg.start_address.split(',')[0]}</strong> → <strong>${leg.end_address.split(',')[0]}</strong></div>`;
    directionsPanel.appendChild(header);

    leg.steps.forEach(step => {
        const row = document.createElement('div');
        row.className = 'direction-step';
        const icon = getManeuverIcon(step.maneuver || '', step.instructions || '');
        row.innerHTML = `<div class="step-icon">${icon}</div><div class="step-content"><div class="step-instruction">${step.instructions}</div><div class="step-dist">${step.distance ? step.distance.text : ''}</div></div>`;
        row.addEventListener('click', () => { map.panTo(step.start_location); map.setZoom(16); });
        directionsPanel.appendChild(row);
    });

    const arrive = document.createElement('div');
    arrive.className = 'direction-step arrive';
    arrive.innerHTML = `<div class="step-icon">📍</div><div class="step-content"><div class="step-instruction"><strong>Arrive at ${leg.end_address.split(',')[0]}</strong></div></div>`;
    directionsPanel.appendChild(arrive);
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
        precipBars += `<rect x="${x - 8}" y="${chartH - precipH}" width="16" height="${precipH}" fill="#4285f4" opacity="0.3" rx="2"/>`;
    });

    let labels = '';
    valid.forEach((wp, i) => {
        const x = i * 60 + 30;
        const y = chartH - ((wp.temperature - minTemp) / range) * (chartH - 10) - 5;
        labels += `<text x="${x}" y="${y - 6}" text-anchor="middle" font-size="10" fill="#3c4043">${Math.round(wp.temperature)}°</text>`;
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        labels += `<text x="${x}" y="${chartH + 12}" text-anchor="middle" font-size="9" fill="#80868b">${timeStr}</text>`;
        if (wp.precipitationProb > 0) {
            labels += `<text x="${x}" y="${chartH + 22}" text-anchor="middle" font-size="9" fill="#4285f4">${wp.precipitationProb}%</text>`;
        }
    });

    weatherChart.innerHTML = `<svg width="${w}" height="${chartH + 26}" viewBox="0 0 ${w} ${chartH + 26}">
        ${precipBars}
        <path d="${tempPath}" fill="none" stroke="#ea4335" stroke-width="2"/>
        ${valid.map((wp, i) => {
            const x = i * 60 + 30;
            const y = chartH - ((wp.temperature - minTemp) / range) * (chartH - 10) - 5;
            return `<circle cx="${x}" cy="${y}" r="3" fill="#ea4335"/>`;
        }).join('')}
        ${labels}
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

function getRoute(origin, destination, waypoints) {
    return new Promise((resolve, reject) => {
        const req = {
            origin, destination,
            travelMode: google.maps.TravelMode.DRIVING,
            provideRouteAlternatives: !waypoints || waypoints.length === 0,
            drivingOptions: { departureTime: new Date(), trafficModel: 'bestguess' }
        };
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
    snow: { label: 'Snow', color: '#a142f4', icon: '🌨️', codes: [66, 67, 71, 73, 75, 77, 85, 86] },
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
    const green = '#34a853', orange = '#ea8600', red = '#ea4335';
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
        if (wp.noForecast) detail = `<div class="overlay-detail"><strong>${wp.locationName}</strong><br>${timeStr} · ${dateStr}<br><span style="color:#80868b">No forecast</span></div>`;
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
        const borderColor = wp.noForecast ? '#dadce0' : catInfo.color;
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const label = wp.isStart ? 'Start' : wp.isEnd ? 'End' : `${wp.distanceMiles} mi`;
        const card = document.createElement('div');
        card.className = 'weather-card';
        card.style.borderLeftColor = borderColor;
        if (wp.noForecast) {
            card.innerHTML = `<div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${label}</div><div class="weather-icon" style="opacity:0.4">—</div><div class="temp" style="color:#80868b">N/A</div>`;
        } else {
            const precipText = wp.precipitationAmount > 0 ? `${wp.precipitationAmount.toFixed(2)}"` : `${wp.precipitationProb}%`;
            card.innerHTML = `<div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${label}</div><div class="weather-icon">${info.icon}</div><div class="temp">${Math.round(wp.temperature)}°F</div><div class="description">${info.desc}</div><div class="extra">💨 ${Math.round(wp.windSpeed)} mph · 💧 ${precipText}</div>`;
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
            shareTripBtn.title = 'Copied!';
            setTimeout(() => shareTripBtn.title = 'Share trip', 2000);
        });
    }
}

function printTrip() {
    if (!currentWeatherData || !currentDirectionsResult) return;
    const rd = currentRouteData.find(r => r.weatherData === currentWeatherData);
    const route = currentDirectionsResult.routes[rd ? rd.routeIndex : 0];
    const leg = route.legs[0];
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Trip Summary</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:20px auto;padding:0 20px}h1{color:#1a73e8;font-size:20px}h2{font-size:16px;margin-top:20px;border-bottom:1px solid #e8eaed;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{padding:6px 10px;text-align:left;border-bottom:1px solid #f1f3f4;font-size:13px}th{background:#f8f9fa;font-weight:500}.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:4px}.score{background:#e8f0fe;color:#1967d2}@media print{body{margin:0}}</style></head><body>`);
    w.document.write(`<h1>🚗 Trip: ${leg.start_address} → ${leg.end_address}</h1>`);
    w.document.write(`<p>${formatDuration((leg.duration_in_traffic || leg.duration).value)} · ${Math.round(leg.distance.value / 1609.34)} miles via ${route.summary || 'route'}</p>`);
    if (rd) w.document.write(`<p><span class="badge score">Route Score: ${rd.score}/10</span></p>`);
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
    w.document.write(`</ol><p style="color:#80868b;font-size:11px;margin-top:30px">Generated by Weather on the Road · ${new Date().toLocaleDateString()}</p></body></html>`);
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
    if (text.includes('uturn') || text.includes('u-turn')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M18 9v12h-2V9c0-2.21-1.79-4-4-4S8 6.79 8 9v4.17l1.59-1.59L11 13l-4 4-4-4 1.41-1.41L6 13.17V9c0-3.31 2.69-6 6-6s6 2.69 6 6z"/></svg>';
    if (text.includes('sharp-left') || text.includes('sharp left')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M6 6.83L4.41 8.41 3 7l4-4 4 4-1.41 1.41L8 6.83V13h8c1.1 0 2 .9 2 2v6h-2v-6H8c-1.1 0-2-.9-2-2V6.83z"/></svg>';
    if (text.includes('sharp-right') || text.includes('sharp right')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M18 6.83l-1.59 1.58L15 7l4-4 4 4-1.41 1.41L20 6.83V13h-8c-1.1 0-2 .9-2 2v6H8v-6c0-1.1-.9-2-2-2h8V6.83z"/></svg>';
    if (text.includes('turn-left') || text.includes('turn left') || text.includes('left')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M14 7l-5 5 5 5V7zm7 10v2H3v-2h18z"/></svg>';
    if (text.includes('turn-right') || text.includes('turn right') || text.includes('right')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M10 17l5-5-5-5v10zm-7 0v2h18v-2H3z"/></svg>';
    if (text.includes('roundabout')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-13v2.17l-1.59-1.59L8 9l4 4 4-4-1.41-1.41L13 9.17V7h-2z"/></svg>';
    if (text.includes('merge')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M17 4l-1.41 1.41L17.17 7H8c-2.76 0-5 2.24-5 5v5h2v-5c0-1.65 1.35-3 3-3h9.17l-1.58 1.59L17 12l4-4-4-4z"/></svg>';
    if (text.includes('ramp') || text.includes('exit') || text.includes('off-ramp')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M18 6.83l1.59 1.58L21 7l-4-4-4 4 1.41 1.41L16 6.83V10c0 3.07-1.64 5.64-4 7.08V4h-2v13.08C7.64 15.64 6 13.07 6 10V6.83L7.59 8.41 9 7 5 3 1 7l1.41 1.41L4 6.83V10c0 3.72 2.01 6.94 5 8.72V21h6v-2.28c2.99-1.78 5-5 5-8.72V6.83z"/></svg>';
    if (text.includes('fork')) return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M14 7l5 5-5 5V7zM3 17v2h18v-2H3zM10 7v10l-5-5 5-5z"/></svg>';
    return '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5f6368" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
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

function showError(msg) { errorMessage.textContent = msg; errorMessage.classList.remove('hidden'); }
function hideError() { errorMessage.classList.add('hidden'); }
