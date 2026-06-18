const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const departureDateInput = document.getElementById('departure-date');
const departureTimeInput = document.getElementById('departure-time');
const planButton = document.getElementById('plan-trip');
const errorMessage = document.getElementById('error-message');
const weatherTimeline = document.getElementById('weather-timeline');
const timelineCards = document.getElementById('timeline-cards');
const directionsPanel = document.getElementById('directions-panel');
const weatherInfoPanel = document.getElementById('weather-info-panel');
const weatherBarsSection = document.getElementById('weather-bars-section');

let map = null;
let directionsRenderer = null;
let weatherOverlays = [];
let WeatherOverlay = null;
let lastRouteBounds = null;
let showOverlaysFlag = true;
let currentWeatherData = null;
let cachedRouteWeather = null;
let cachedDirectionsResult = null;
let cachedDepartureTime = null;

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
            const projection = this.getProjection();
            const pos = projection.fromLatLngToDivPixel(this.position);
            if (pos) {
                this.div.style.left = (pos.x - 20) + 'px';
                this.div.style.top = (pos.y - 15) + 'px';
            }
        }

        onRemove() {
            if (this.div) {
                this.div.parentNode.removeChild(this.div);
                this.div = null;
            }
        }
    };

    try {
        map = new google.maps.Map(document.getElementById('map'), {
            center: { lat: 39.8283, lng: -98.5795 },
            zoom: 5,
            gestureHandling: 'greedy',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControlOptions: {
                position: google.maps.ControlPosition.RIGHT_CENTER
            }
        });

        directionsRenderer = new google.maps.DirectionsRenderer({
            map,
            panel: directionsPanel,
            suppressMarkers: false,
            polylineOptions: {
                strokeColor: '#4285F4',
                strokeWeight: 5,
                strokeOpacity: 0.8,
            }
        });

        directionsRenderer.addListener('routeindex_changed', () => {
            const idx = directionsRenderer.getRouteIndex();
            onRouteChanged(idx);
        });

        const recenterBtn = document.createElement('button');
        recenterBtn.id = 'recenter-map';
        recenterBtn.title = 'Reset map view';
        recenterBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 22v-6h6"/></svg>`;
        map.controls[google.maps.ControlPosition.RIGHT_TOP].push(recenterBtn);
        recenterBtn.addEventListener('click', () => {
            if (lastRouteBounds) {
                map.fitBounds(lastRouteBounds, { top: 20, left: 20, right: 40, bottom: 40 });
            } else {
                map.setCenter({ lat: 39.8283, lng: -98.5795 });
                map.setZoom(5);
            }
        });

        const originSearchBox = new google.maps.places.SearchBox(originInput);
        const destSearchBox = new google.maps.places.SearchBox(destinationInput);

        map.addListener('bounds_changed', () => {
            originSearchBox.setBounds(map.getBounds());
            destSearchBox.setBounds(map.getBounds());
        });

        originSearchBox.addListener('places_changed', () => {
            const places = originSearchBox.getPlaces();
            if (!places || places.length === 0) return;
            const place = places[0];
            if (place.geometry) {
                if (place.geometry.viewport) map.fitBounds(place.geometry.viewport);
                else { map.panTo(place.geometry.location); map.setZoom(14); }
            }
        });

        destSearchBox.addListener('places_changed', () => {
            const places = destSearchBox.getPlaces();
            if (!places || places.length === 0) return;
            const place = places[0];
            if (place.geometry) {
                if (place.geometry.viewport) map.fitBounds(place.geometry.viewport);
                else { map.panTo(place.geometry.location); map.setZoom(14); }
            }
        });

        planButton.addEventListener('click', () => planTrip());

        document.getElementById('toggle-overlays').addEventListener('change', (e) => {
            showOverlaysFlag = e.target.checked;
            if (showOverlaysFlag && currentWeatherData) {
                showOverlaysOnMap(currentWeatherData);
            } else {
                weatherOverlays.forEach(o => o.setMap(null));
                weatherOverlays = [];
            }
        });
    } catch (err) {
        showError('Google Maps failed to initialize: ' + err.message);
    }
}
window.initApp = initApp;

function clearMap() {
    weatherOverlays.forEach(o => o.setMap(null));
    weatherOverlays = [];
}

async function planTrip() {
    hideError();
    if (!originInput.value.trim()) { showError('Please enter a starting point.'); return; }
    if (!destinationInput.value.trim()) { showError('Please enter a destination.'); return; }
    if (!departureDateInput.value) { showError('Please select a departure date.'); return; }

    planButton.disabled = true;
    planButton.textContent = 'Loading...';
    directionsPanel.innerHTML = '<div class="loading">Calculating routes...</div>';
    weatherInfoPanel.classList.add('hidden');
    weatherTimeline.classList.remove('hidden');
    timelineCards.innerHTML = '<div class="loading">Fetching weather data...</div>';

    try {
        const result = await getRoute(originInput.value, destinationInput.value);
        cachedDirectionsResult = result;
        cachedDepartureTime = new Date(`${departureDateInput.value}T${departureTimeInput.value}:00`);

        directionsRenderer.setDirections(result);
        directionsRenderer.setRouteIndex(0);

        cachedRouteWeather = {};
        for (let r = 0; r < result.routes.length; r++) {
            const waypoints = sampleWaypoints(result, r, cachedDepartureTime);
            const weatherData = await getWeatherForWaypoints(waypoints);
            const withForecast = weatherData.filter(w => !w.noForecast);
            const maxRain = withForecast.length ? Math.max(...withForecast.map(w => w.precipitationProb)) : 0;
            const badWeatherCount = withForecast.filter(w => [55, 61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82, 85, 86, 95, 96, 99].includes(w.weatherCode)).length;
            const alerts = getWeatherAlerts(weatherData);
            cachedRouteWeather[r] = { weatherData, maxRain, badWeatherCount, alerts };
        }

        onRouteChanged(0);

    } catch (err) {
        showError('Something went wrong: ' + err.message);
        weatherTimeline.classList.add('hidden');
        directionsPanel.innerHTML = '';
    } finally {
        planButton.disabled = false;
        planButton.textContent = 'Go';
    }
}

function onRouteChanged(routeIndex) {
    if (!cachedRouteWeather || !cachedRouteWeather[routeIndex]) return;

    const rd = cachedRouteWeather[routeIndex];
    const route = cachedDirectionsResult.routes[routeIndex];

    currentWeatherData = rd.weatherData;
    showWeatherBars(route, rd);
    showWeatherCards(rd.weatherData);
    if (showOverlaysFlag) showOverlaysOnMap(rd.weatherData);

    const bounds = new google.maps.LatLngBounds();
    route.overview_path.forEach(p => bounds.extend(p));
    lastRouteBounds = bounds;
}

function showWeatherBars(route, rd) {
    weatherInfoPanel.classList.remove('hidden');

    const { barHtml, legendHtml } = buildWeatherBar(rd.weatherData);
    const traffic = getStepTrafficSegments(route);
    const trafficBarHtml = traffic.segments.map(s => `<div style="flex:${s.pct};background:${s.color};height:100%;"></div>`).join('');

    let alertsHtml = '';
    if (rd.alerts.length > 0) {
        const alertItems = rd.alerts.map(a => {
            let cls = 'alert-caution';
            if (a.type === 'danger') cls = 'alert-danger';
            else if (a.type === 'warning') cls = 'alert-warning';
            return `<div class="route-alert ${cls}">${a.icon} ${a.text}</div>`;
        }).join('');
        alertsHtml = `<div class="route-alerts">${alertItems}</div>`;
    }

    weatherBarsSection.innerHTML = `
        <div class="weather-summary-title">Weather & Traffic</div>
        <div class="route-bars">
            <div class="bar-row"><span class="bar-label">Weather</span><div class="weather-bar-container"><div class="weather-bar">${barHtml}</div></div></div>
            <div class="weather-bar-legend">${legendHtml}</div>
            <div class="bar-row" style="margin-top:6px"><span class="bar-label">Traffic</span><div class="weather-bar-container"><div class="weather-bar">${trafficBarHtml}</div></div><span class="traffic-text" style="color:${traffic.labelColor}">${traffic.label}</span></div>
        </div>
        ${alertsHtml}
    `;
}

function getWeatherAlerts(weatherData) {
    const alerts = [];
    const withForecast = weatherData.filter(w => !w.noForecast);

    for (const wp of withForecast) {
        const info = weatherCodeToInfo(wp.weatherCode);
        const cat = getWeatherCategory(wp.weatherCode);

        if (cat === 'storm') {
            alerts.push({ type: 'danger', icon: '⚡', text: `${info.desc} near ${wp.locationName}` });
        } else if (cat === 'snow') {
            alerts.push({ type: 'warning', icon: '🌨️', text: `${info.desc} near ${wp.locationName}` });
        } else if (wp.weatherCode === 65 || wp.weatherCode === 82) {
            alerts.push({ type: 'warning', icon: '🌧️', text: `${info.desc} near ${wp.locationName}` });
        } else if (wp.weatherCode === 45 || wp.weatherCode === 48) {
            alerts.push({ type: 'caution', icon: '🌫️', text: `${info.desc} near ${wp.locationName}` });
        }

        if (wp.windSpeed >= 30) {
            alerts.push({ type: 'warning', icon: '💨', text: `High winds (${Math.round(wp.windSpeed)} mph) near ${wp.locationName}` });
        }

        if (wp.temperature <= 32) {
            alerts.push({ type: 'caution', icon: '🥶', text: `Freezing temps (${Math.round(wp.temperature)}°F) near ${wp.locationName}` });
        } else if (wp.temperature >= 100) {
            alerts.push({ type: 'caution', icon: '🔥', text: `Extreme heat (${Math.round(wp.temperature)}°F) near ${wp.locationName}` });
        }
    }

    return alerts;
}

function getRoute(origin, destination) {
    return new Promise((resolve, reject) => {
        const directionsService = new google.maps.DirectionsService();
        directionsService.route({
            origin, destination,
            travelMode: google.maps.TravelMode.DRIVING,
            provideRouteAlternatives: true,
            drivingOptions: { departureTime: new Date(), trafficModel: 'bestguess' }
        }, (result, status) => {
            if (status === 'OK') resolve(result);
            else reject(new Error('Could not find a route. ' + status));
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
    return new Promise((resolve) => {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng: lon } }, (results, status) => {
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
    const locationNames = await Promise.all(waypoints.map(wp =>
        wp.locationName ? Promise.resolve(wp.locationName) : reverseGeocode(wp.lat, wp.lon)
    ));

    return Promise.all(waypoints.map(async (wp, i) => {
        const dateStr = wp.arrivalTime.toISOString().split('T')[0];
        const hour = wp.arrivalTime.getHours();
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${wp.lat}&longitude=${wp.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.error || !data.hourly || !data.hourly.temperature_2m) {
                return { ...wp, locationName: locationNames[i], temperature: null, humidity: null, precipitationProb: null, weatherCode: null, windSpeed: null, noForecast: true };
            }
            const h = Math.min(hour, data.hourly.time.length - 1);
            return { ...wp, locationName: locationNames[i], temperature: data.hourly.temperature_2m[h], humidity: data.hourly.relative_humidity_2m[h], precipitationProb: data.hourly.precipitation_probability[h], weatherCode: data.hourly.weathercode[h], windSpeed: data.hourly.windspeed_10m[h] };
        } catch (e) {
            return { ...wp, locationName: locationNames[i], temperature: null, humidity: null, precipitationProb: null, weatherCode: null, windSpeed: null, noForecast: true };
        }
    }));
}

const weatherCategories = {
    clear: { label: 'Clear', color: '#48bb78', icon: '☀️', codes: [0, 1] },
    cloudy: { label: 'Cloudy', color: '#b0b8c4', icon: '☁️', codes: [2, 3, 45, 48] },
    rain: { label: 'Rain', color: '#667eea', icon: '🌧️', codes: [51, 53, 55, 61, 63, 65, 80, 81, 82] },
    snow: { label: 'Snow', color: '#a78bfa', icon: '🌨️', codes: [66, 67, 71, 73, 75, 77, 85, 86] },
    storm: { label: 'Storm', color: '#e53e3e', icon: '⚡', codes: [95, 96, 99] },
};

function getWeatherCategory(code) {
    if (code === null || code === undefined) return 'unknown';
    for (const [key, val] of Object.entries(weatherCategories)) {
        if (val.codes.includes(code)) return key;
    }
    return 'clear';
}

function weatherCodeToInfo(code) {
    const mapping = {
        0: { icon: '☀️', desc: 'Clear sky' }, 1: { icon: '🌤️', desc: 'Mainly clear' },
        2: { icon: '⛅', desc: 'Partly cloudy' }, 3: { icon: '☁️', desc: 'Overcast' },
        45: { icon: '🌫️', desc: 'Foggy' }, 48: { icon: '🌫️', desc: 'Freezing fog' },
        51: { icon: '🌦️', desc: 'Light drizzle' }, 53: { icon: '🌦️', desc: 'Moderate drizzle' },
        55: { icon: '🌧️', desc: 'Heavy drizzle' }, 61: { icon: '🌧️', desc: 'Light rain' },
        63: { icon: '🌧️', desc: 'Moderate rain' }, 65: { icon: '🌧️', desc: 'Heavy rain' },
        66: { icon: '❄️', desc: 'Freezing rain' }, 67: { icon: '❄️', desc: 'Heavy freezing rain' },
        71: { icon: '🌨️', desc: 'Light snow' }, 73: { icon: '🌨️', desc: 'Moderate snow' },
        75: { icon: '🌨️', desc: 'Heavy snow' }, 77: { icon: '❄️', desc: 'Snow grains' },
        80: { icon: '🌦️', desc: 'Light showers' }, 81: { icon: '🌧️', desc: 'Moderate showers' },
        82: { icon: '⛈️', desc: 'Violent showers' }, 85: { icon: '🌨️', desc: 'Light snow showers' },
        86: { icon: '🌨️', desc: 'Heavy snow showers' }, 95: { icon: '⚡', desc: 'Thunderstorm' },
        96: { icon: '⚡', desc: 'Thunderstorm with hail' }, 99: { icon: '⚡', desc: 'Thunderstorm with heavy hail' },
    };
    return mapping[code] || { icon: '❓', desc: 'Unknown' };
}

function buildWeatherBar(weatherData) {
    const segments = [];
    for (let i = 0; i < weatherData.length - 1; i++) {
        const cat = getWeatherCategory(weatherData[i].weatherCode);
        const widthPct = (weatherData[i + 1].fraction - weatherData[i].fraction) * 100;
        const unknownInfo = { label: 'No forecast', color: '#e2e8f0', icon: '—' };
        const info = cat === 'unknown' ? unknownInfo : weatherCategories[cat];
        segments.push({ width: widthPct, color: info.color, icon: info.icon, label: info.label, location: weatherData[i].locationName });
    }
    const barHtml = segments.map(s => `<div style="flex:${s.width};background:${s.color};height:100%;" title="${s.icon} ${s.label} at ${s.location}"></div>`).join('');
    const totals = {};
    segments.forEach(s => { if (!totals[s.label]) totals[s.label] = { width: 0, icon: s.icon, color: s.color }; totals[s.label].width += s.width; });
    const legendHtml = Object.entries(totals).map(([label, t]) =>
        `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.75rem;color:#4a5568;"><span style="width:8px;height:8px;border-radius:50%;background:${t.color};display:inline-block;"></span>${t.icon} ${label} ${Math.round(t.width)}%</span>`
    ).join(' ');
    return { barHtml, legendHtml };
}

function getStepTrafficSegments(route) {
    const leg = route.legs[0];
    const steps = leg.steps;
    const totalDuration = leg.duration.value;
    const totalTraffic = leg.duration_in_traffic ? leg.duration_in_traffic.value : totalDuration;
    const overallRatio = totalTraffic / totalDuration;

    const trafficFree = '#38a169';
    const trafficModerate = '#dd6b20';
    const trafficHeavy = '#c53030';

    if (!leg.duration_in_traffic || overallRatio <= 1.02) {
        return { segments: [{ pct: 100, color: trafficFree }], label: 'Clear', labelColor: trafficFree, delayMin: 0 };
    }

    const delayMin = Math.round((totalTraffic - totalDuration) / 60);
    const rawSegments = [];

    for (const step of steps) {
        const stepPct = (step.duration.value / totalDuration) * 100;
        const distKm = step.distance.value / 1000;
        const durationHr = step.duration.value / 3600;
        const speedKmh = durationHr > 0 ? distKm / durationHr : 100;

        let color;
        if (speedKmh >= 70) color = trafficFree;
        else if (speedKmh >= 30) color = trafficModerate;
        else color = trafficHeavy;

        rawSegments.push({ pct: stepPct, color });
    }

    const merged = [];
    for (const seg of rawSegments) {
        const last = merged[merged.length - 1];
        if (last && last.color === seg.color) last.pct += seg.pct;
        else merged.push({ ...seg });
    }

    let label, labelColor;
    if (overallRatio <= 1.1) { label = `Light (+${delayMin} min)`; labelColor = trafficFree; }
    else if (overallRatio <= 1.25) { label = `Moderate (+${delayMin} min)`; labelColor = trafficModerate; }
    else { label = `Heavy (+${delayMin} min)`; labelColor = trafficHeavy; }

    return { segments: merged, label, labelColor, delayMin };
}

function showOverlaysOnMap(weatherData) {
    weatherOverlays.forEach(o => o.setMap(null));
    weatherOverlays = [];

    weatherData.forEach((wp) => {
        const info = wp.noForecast ? { icon: '—', desc: 'No forecast available' } : weatherCodeToInfo(wp.weatherCode);
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = wp.arrivalTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const tempDisplay = wp.noForecast ? '?' : `${Math.round(wp.temperature)}°`;

        let detailHtml;
        if (wp.noForecast) {
            detailHtml = `<div class="overlay-detail"><strong>${wp.locationName}</strong><br><span>${timeStr} · ${dateStr}</span><br><span style="color:#999">No forecast</span></div>`;
        } else {
            detailHtml = `<div class="overlay-detail"><strong>${wp.locationName}</strong><br><span>${timeStr} · ${dateStr}</span><br><span>${info.desc}</span><br><span>Wind: ${Math.round(wp.windSpeed)} mph</span>${wp.precipitationProb > 0 ? `<br><span>${wp.precipitationProb}% precip</span>` : ''}</div>`;
        }

        const overlayHtml = `<div class="weather-overlay-minimal${wp.noForecast ? ' no-forecast' : ''}"><span class="overlay-icon-mini">${info.icon}</span><span class="overlay-temp-mini">${tempDisplay}</span>${detailHtml}</div>`;

        const overlay = new WeatherOverlay(new google.maps.LatLng(wp.lat, wp.lon), overlayHtml, map);
        weatherOverlays.push(overlay);
    });
}

function showWeatherCards(weatherData) {
    weatherTimeline.classList.remove('hidden');
    timelineCards.innerHTML = '';

    weatherData.forEach((wp) => {
        const info = wp.noForecast ? { icon: '—', desc: 'No forecast available' } : weatherCodeToInfo(wp.weatherCode);
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = wp.arrivalTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const label = wp.isStart ? 'Departure' : wp.isEnd ? 'Arrival' : `${wp.distanceMiles} mi`;
        const cardClass = wp.isStart ? 'start' : wp.isEnd ? 'end' : '';

        const card = document.createElement('div');
        card.className = `weather-card ${cardClass}`;
        if (wp.noForecast) {
            card.innerHTML = `<div class="time-info"><div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${dateStr}</div><div class="arrival-time">${label}</div></div><div class="weather-icon" style="opacity:0.4">—</div><div class="weather-details"><div class="temp" style="color:#a0aec0">N/A</div><div class="description" style="color:#a0aec0">Forecast not available this far ahead</div></div>`;
        } else {
            card.innerHTML = `<div class="time-info"><div class="location-name">${wp.locationName}</div><div class="arrival-time">${timeStr} · ${dateStr}</div><div class="arrival-time">${label}</div></div><div class="weather-icon">${info.icon}</div><div class="weather-details"><div class="temp">${Math.round(wp.temperature)}°F</div><div class="description">${info.desc}</div><div class="extra">Wind: ${Math.round(wp.windSpeed)} mph · Humidity: ${wp.humidity}%${wp.precipitationProb > 0 ? ` · ${wp.precipitationProb}% chance of precip` : ''}</div></div>`;
        }
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
            map.panTo({ lat: wp.lat, lng: wp.lon });
            map.setZoom(10);
        });
        timelineCards.appendChild(card);
    });
}

function showError(msg) { errorMessage.textContent = msg; errorMessage.classList.remove('hidden'); }
function hideError() { errorMessage.classList.add('hidden'); }
