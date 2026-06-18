const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const departureDateInput = document.getElementById('departure-date');
const departureTimeInput = document.getElementById('departure-time');
const planButton = document.getElementById('plan-trip');
const errorMessage = document.getElementById('error-message');
const weatherTimeline = document.getElementById('weather-timeline');
const timelineCards = document.getElementById('timeline-cards');
const routesSection = document.getElementById('routes-section');
const routesList = document.getElementById('routes-list');
const myLocationBtn = document.getElementById('my-location-btn');

let map = null;
let directionsRenderers = [];
let weatherOverlays = [];
let routeInfoOverlays = [];
let WeatherOverlay = null;
let RouteInfoOverlay = null;
let lastRouteBounds = null;
let showOverlaysFlag = true;
let currentWeatherData = null;
let mapClickMode = null; // 'origin' or 'destination'

const now = new Date();
departureDateInput.value = now.toISOString().split('T')[0];
departureDateInput.min = now.toISOString().split('T')[0];
departureTimeInput.value = now.toTimeString().slice(0, 5);

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
        constructor(position, content, mapInstance, offsetY) {
            super();
            this.position = position;
            this.content = content;
            this.offsetY = offsetY || -35;
            this.div = null;
            this.setMap(mapInstance);
        }
        onAdd() {
            this.div = document.createElement('div');
            this.div.innerHTML = this.content;
            this.div.style.position = 'absolute';
            this.div.style.zIndex = '2';
            this.getPanes().overlayMouseTarget.appendChild(this.div);
        }
        draw() {
            const p = this.getProjection().fromLatLngToDivPixel(this.position);
            if (p) { this.div.style.left = (p.x - 40) + 'px'; this.div.style.top = (p.y + this.offsetY) + 'px'; }
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
            if (places && places.length > 0 && places[0].geometry) {
                map.panTo(places[0].geometry.location);
                map.setZoom(14);
            }
        });

        destSearchBox.addListener('places_changed', () => {
            const places = destSearchBox.getPlaces();
            if (places && places.length > 0 && places[0].geometry) {
                map.panTo(places[0].geometry.location);
                map.setZoom(14);
            }
        });

        myLocationBtn.addEventListener('click', () => {
            if (!navigator.geolocation) { showError('Geolocation not supported.'); return; }
            myLocationBtn.style.opacity = '0.5';
            navigator.geolocation.getCurrentPosition(pos => {
                const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ location: latlng }, (results, status) => {
                    myLocationBtn.style.opacity = '1';
                    if (status === 'OK' && results[0]) {
                        originInput.value = results[0].formatted_address;
                        map.panTo(latlng);
                        map.setZoom(14);
                    } else {
                        originInput.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
                    }
                });
            }, () => {
                myLocationBtn.style.opacity = '1';
                showError('Could not get your location.');
            });
        });

        map.addListener('click', (e) => {
            if (!mapClickMode) return;
            const latlng = e.latLng;
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: latlng }, (results, status) => {
                const addr = (status === 'OK' && results[0]) ? results[0].formatted_address : `${latlng.lat().toFixed(6)}, ${latlng.lng().toFixed(6)}`;
                if (mapClickMode === 'origin') originInput.value = addr;
                else if (mapClickMode === 'destination') destinationInput.value = addr;
                mapClickMode = null;
                map.setOptions({ draggableCursor: null });
                originInput.classList.remove('picking');
                destinationInput.classList.remove('picking');
            });
        });

        originInput.addEventListener('focus', () => {
            mapClickMode = 'origin';
            map.setOptions({ draggableCursor: 'crosshair' });
            originInput.classList.add('picking');
            destinationInput.classList.remove('picking');
        });
        destinationInput.addEventListener('focus', () => {
            mapClickMode = 'destination';
            map.setOptions({ draggableCursor: 'crosshair' });
            destinationInput.classList.add('picking');
            originInput.classList.remove('picking');
        });

        planButton.addEventListener('click', () => {
            mapClickMode = null;
            map.setOptions({ draggableCursor: null });
            originInput.classList.remove('picking');
            destinationInput.classList.remove('picking');
            planTrip();
        });

        document.getElementById('toggle-overlays').addEventListener('change', (e) => {
            showOverlaysFlag = e.target.checked;
            if (showOverlaysFlag && currentWeatherData) showOverlaysOnMap(currentWeatherData);
            else { weatherOverlays.forEach(o => o.setMap(null)); weatherOverlays = []; }
        });
    } catch (err) {
        showError('Google Maps failed to initialize: ' + err.message);
    }
}
window.initApp = initApp;

function clearMap() {
    weatherOverlays.forEach(o => o.setMap(null)); weatherOverlays = [];
    directionsRenderers.forEach(r => r.setMap(null)); directionsRenderers = [];
    routeInfoOverlays.forEach(o => o.setMap(null)); routeInfoOverlays = [];
}

async function planTrip() {
    hideError();
    if (!originInput.value.trim()) { showError('Please enter a starting point.'); return; }
    if (!destinationInput.value.trim()) { showError('Please enter a destination.'); return; }
    if (!departureDateInput.value) { showError('Please select a departure date.'); return; }

    planButton.disabled = true;
    planButton.textContent = 'Searching...';
    routesSection.classList.remove('hidden');
    routesList.innerHTML = '<div class="loading">Finding routes...</div>';
    weatherTimeline.classList.add('hidden');

    try {
        const result = await getRoute(originInput.value, destinationInput.value);
        const departureTime = new Date(`${departureDateInput.value}T${departureTimeInput.value}:00`);

        routesList.innerHTML = '<div class="loading">Loading weather...</div>';

        const routeData = [];
        const maxRoutes = Math.min(result.routes.length, 3);
        for (let r = 0; r < maxRoutes; r++) {
            const waypoints = sampleWaypoints(result, r, departureTime);
            const weatherData = await getWeatherForWaypoints(waypoints);
            const withForecast = weatherData.filter(w => !w.noForecast);
            const maxRain = withForecast.length ? Math.max(...withForecast.map(w => w.precipitationProb)) : 0;
            const badWeatherCount = withForecast.filter(w =>
                [55, 61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82, 85, 86, 95, 96, 99].includes(w.weatherCode)
            ).length;
            const alerts = getWeatherAlerts(weatherData);
            const route = result.routes[r];
            const leg = route.legs[0];
            const duration = (leg.duration_in_traffic || leg.duration).value;
            routeData.push({ routeIndex: r, weatherData, maxRain, badWeatherCount, alerts, duration });
        }

        const fastestIdx = routeData.reduce((min, rd, i) => rd.duration < routeData[min].duration ? i : min, 0);
        const bestWeatherIdx = routeData.reduce((best, rd, i) => {
            if (rd.badWeatherCount < routeData[best].badWeatherCount) return i;
            if (rd.badWeatherCount === routeData[best].badWeatherCount && rd.maxRain < routeData[best].maxRain) return i;
            return best;
        }, 0);

        routeData.forEach((rd, i) => {
            rd.isFastest = i === fastestIdx;
            rd.isBestWeather = i === bestWeatherIdx;
        });

        displayRoutes(result, routeData, departureTime);

    } catch (err) {
        showError('Could not find a route: ' + err.message);
        routesList.innerHTML = '';
    } finally {
        planButton.disabled = false;
        planButton.textContent = 'Search';
    }
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
                map,
                directions: directionsResult,
                routeIndex: rd.routeIndex,
                suppressMarkers: !isSelected,
                preserveViewport: true,
                polylineOptions: {
                    strokeColor: isSelected ? '#4285F4' : '#BDC1C6',
                    strokeWeight: isSelected ? 5 : 4,
                    strokeOpacity: isSelected ? 1.0 : 0.6,
                    zIndex: isSelected ? 10 : 1,
                }
            });
            directionsRenderers.push(renderer);

            const pathLen = route.overview_path.length;
            const midIdx = Math.floor(pathLen * (0.35 + i * 0.15));
            const midPoint = route.overview_path[Math.min(midIdx, pathLen - 1)];
            const duration = leg.duration_in_traffic || leg.duration;
            const distMiles = Math.round(leg.distance.value / 1609.34);
            const infoHtml = `<div class="route-info-box ${isSelected ? '' : 'alt'}"><div class="rib-duration">${duration.text}</div><div class="rib-distance">${distMiles} miles</div></div>`;
            const infoOverlay = new RouteInfoOverlay(midPoint, infoHtml, map, -40);
            routeInfoOverlays.push(infoOverlay);
        });

        document.querySelectorAll('.route-option').forEach((el, i) => {
            el.classList.toggle('selected', i === selectedIdx);
        });

        const rd = routeData[selectedIdx];
        currentWeatherData = rd.weatherData;
        showWeatherCards(rd.weatherData);
        if (showOverlaysFlag) showOverlaysOnMap(rd.weatherData);
    }

    routeData.forEach((rd, idx) => {
        const route = directionsResult.routes[rd.routeIndex];
        const leg = route.legs[0];
        const duration = leg.duration_in_traffic || leg.duration;
        const baseDuration = leg.duration;
        const distMiles = Math.round(leg.distance.value / 1609.34);
        const summary = route.summary || `Route ${idx + 1}`;

        const { barHtml: weatherBarHtml, iconsHtml: weatherIconsHtml } = buildWeatherBar(rd.weatherData);
        const traffic = getStepTrafficSegments(route);
        const trafficBarHtml = traffic.segments.map(s =>
            `<div style="flex:${s.pct};background:${s.color};height:100%;"></div>`
        ).join('');

        let badgesHtml = '';
        if (rd.isFastest && routeData.length > 1) badgesHtml += '<span class="badge badge-fastest">Fastest</span>';
        if (rd.isBestWeather && routeData.length > 1) badgesHtml += '<span class="badge badge-best-weather">Best weather</span>';
        if (rd.badWeatherCount > 0) badgesHtml += `<span class="badge badge-bad-weather">${rd.badWeatherCount} bad stretch${rd.badWeatherCount > 1 ? 'es' : ''}</span>`;
        else if (rd.maxRain > 50) badgesHtml += `<span class="badge badge-warning">Up to ${rd.maxRain}% rain</span>`;

        let alertsHtml = '';
        if (rd.alerts.length > 0) {
            alertsHtml = '<div class="route-alerts-compact">' + rd.alerts.slice(0, 3).map(a => {
                const cls = a.type === 'danger' ? 'danger' : a.type === 'warning' ? 'warning' : 'caution';
                return `<div class="alert-inline ${cls}">${a.icon} ${a.text}</div>`;
            }).join('') + '</div>';
        }

        const btn = document.createElement('button');
        btn.className = `route-option ${idx === 0 ? 'selected' : ''}`;
        btn.innerHTML = `
            <div class="route-option-header">
                <span class="route-name">via ${summary}</span>
                <span class="route-duration">${duration.text}</span>
            </div>
            <div class="route-meta">${baseDuration.text} without traffic · ${distMiles} miles</div>
            ${badgesHtml ? '<div class="route-badges">' + badgesHtml + '</div>' : ''}
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
            ${alertsHtml}
        `;

        btn.addEventListener('click', () => selectRoute(idx));
        routesList.appendChild(btn);
    });

    selectRoute(0);

    const bounds = new google.maps.LatLngBounds();
    directionsResult.routes.forEach(r => r.overview_path.forEach(p => bounds.extend(p)));
    lastRouteBounds = bounds;
    map.fitBounds(bounds, { top: 20, left: 420, right: 40, bottom: 180 });
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

function getRoute(origin, destination) {
    return new Promise((resolve, reject) => {
        new google.maps.DirectionsService().route({
            origin, destination,
            travelMode: google.maps.TravelMode.DRIVING,
            provideRouteAlternatives: true,
            drivingOptions: { departureTime: new Date(), trafficModel: 'bestguess' }
        }, (result, status) => {
            if (status === 'OK') resolve(result);
            else reject(new Error(status));
        });
    });
}

function sampleWaypoints(directionsResult, routeIndex, departureTime) {
    const route = directionsResult.routes[routeIndex];
    const leg = route.legs[0];
    const totalDuration = (leg.duration_in_traffic || leg.duration).value;
    const totalDistance = leg.distance.value;
    const path = route.overview_path;
    const numStops = Math.min(Math.max(Math.ceil(totalDuration / 3600), 3), 12);
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
    waypoints[0].locationName = leg.start_address.split(',')[0];
    waypoints[numStops - 1].locationName = leg.end_address.split(',')[0];
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
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${wp.lat}&longitude=${wp.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`);
            const data = await res.json();
            if (data.error || !data.hourly || !data.hourly.temperature_2m)
                return { ...wp, locationName: names[i], noForecast: true };
            const h = Math.min(hour, data.hourly.time.length - 1);
            return { ...wp, locationName: names[i], temperature: data.hourly.temperature_2m[h], humidity: data.hourly.relative_humidity_2m[h], precipitationProb: data.hourly.precipitation_probability[h], weatherCode: data.hourly.weathercode[h], windSpeed: data.hourly.windspeed_10m[h] };
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
    const segments = [];
    const icons = [];
    for (let i = 0; i < weatherData.length; i++) {
        const wp = weatherData[i];
        const cat = getWeatherCategory(wp.weatherCode);
        const catInfo = cat === 'unknown' ? { color: '#e8eaed', icon: '❓' } : weatherCategories[cat];
        const info = wp.noForecast ? { icon: '—' } : weatherCodeToInfo(wp.weatherCode);
        icons.push({ icon: info.icon, fraction: wp.fraction });
        if (i < weatherData.length - 1) {
            const widthPct = (weatherData[i + 1].fraction - wp.fraction) * 100;
            segments.push({ width: widthPct, color: catInfo.color });
        }
    }
    const barHtml = segments.map(s => `<div style="flex:${s.width};background:${s.color};height:100%;"></div>`).join('');
    const iconsHtml = icons.map(ic => `<span class="weather-bar-icon" style="left:${ic.fraction * 100}%">${ic.icon}</span>`).join('');
    return { barHtml, iconsHtml };
}

function getStepTrafficSegments(route) {
    const leg = route.legs[0];
    const totalDuration = leg.duration.value;
    const totalTraffic = leg.duration_in_traffic ? leg.duration_in_traffic.value : totalDuration;
    const ratio = totalTraffic / totalDuration;
    const green = '#34a853', orange = '#ea8600', red = '#ea4335';

    if (!leg.duration_in_traffic || ratio <= 1.02)
        return { segments: [{ pct: 100, color: green }], label: 'Clear', labelColor: green };

    const delayMin = Math.round((totalTraffic - totalDuration) / 60);
    const raw = [];
    for (const step of leg.steps) {
        const pct = (step.duration.value / totalDuration) * 100;
        const speed = (step.distance.value / 1000) / (step.duration.value / 3600 || 1);
        raw.push({ pct, color: speed >= 70 ? green : speed >= 30 ? orange : red });
    }
    const merged = [];
    for (const s of raw) { const l = merged[merged.length-1]; if (l && l.color === s.color) l.pct += s.pct; else merged.push({...s}); }

    let label, labelColor;
    if (ratio <= 1.1) { label = `+${delayMin}m`; labelColor = green; }
    else if (ratio <= 1.25) { label = `+${delayMin}m`; labelColor = orange; }
    else { label = `+${delayMin}m`; labelColor = red; }
    return { segments: merged, label, labelColor };
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
        else detail = `<div class="overlay-detail"><strong>${wp.locationName}</strong><br>${timeStr} · ${dateStr}<br>${info.desc}<br>Wind: ${Math.round(wp.windSpeed)} mph${wp.precipitationProb > 0 ? `<br>${wp.precipitationProb}% precip` : ''}</div>`;
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
            card.innerHTML = `<div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${label}</div><div class="weather-icon" style="opacity:0.4">—</div><div class="weather-details"><div class="temp" style="color:#80868b">N/A</div></div>`;
        } else {
            card.innerHTML = `<div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${label}</div><div class="weather-icon">${info.icon}</div><div class="weather-details"><div class="temp">${Math.round(wp.temperature)}°F</div><div class="description">${info.desc}</div><div class="extra">Wind ${Math.round(wp.windSpeed)} mph${wp.precipitationProb > 0 ? ` · ${wp.precipitationProb}%` : ''}</div></div>`;
        }
        card.addEventListener('click', () => { map.panTo({ lat: wp.lat, lng: wp.lon }); map.setZoom(10); });
        timelineCards.appendChild(card);
    });
}

function showError(msg) { errorMessage.textContent = msg; errorMessage.classList.remove('hidden'); }
function hideError() { errorMessage.classList.add('hidden'); }
