const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const departureDateInput = document.getElementById('departure-date');
const departureTimeInput = document.getElementById('departure-time');
const planButton = document.getElementById('plan-trip');
const errorMessage = document.getElementById('error-message');
const mainContent = document.getElementById('main-content');
const weatherTimeline = document.getElementById('weather-timeline');
const timelineCards = document.getElementById('timeline-cards');

let map = null;
let directionsRenderer = null;
let altRenderers = [];
let weatherOverlays = [];
let routeMarkers = [];
let WeatherOverlay = null;
let allRoutes = null;
let selectedRouteIndex = 0;

const today = new Date();
departureDateInput.value = today.toISOString().split('T')[0];
departureDateInput.min = today.toISOString().split('T')[0];
const maxDate = new Date(today);
maxDate.setDate(maxDate.getDate() + 14);
departureDateInput.max = maxDate.toISOString().split('T')[0];

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
            this.getPanes().floatPane.appendChild(this.div);
        }

        draw() {
            const projection = this.getProjection();
            const pos = projection.fromLatLngToDivPixel(this.position);
            if (pos) {
                this.div.style.left = (pos.x - 40) + 'px';
                this.div.style.top = (pos.y + 10) + 'px';
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
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControlOptions: {
                position: google.maps.ControlPosition.RIGHT_CENTER
            }
        });

        directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: true,
            polylineOptions: { strokeColor: '#3182ce', strokeWeight: 5, strokeOpacity: 0.8 }
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
                if (place.geometry.viewport) {
                    map.fitBounds(place.geometry.viewport);
                } else {
                    map.panTo(place.geometry.location);
                    map.setZoom(14);
                }
            }
        });

        destSearchBox.addListener('places_changed', () => {
            const places = destSearchBox.getPlaces();
            if (!places || places.length === 0) return;
            const place = places[0];
            if (place.geometry) {
                if (place.geometry.viewport) {
                    map.fitBounds(place.geometry.viewport);
                } else {
                    map.panTo(place.geometry.location);
                    map.setZoom(14);
                }
            }
        });

        planButton.addEventListener('click', () => planTrip());
    } catch (err) {
        showError('Google Maps failed to initialize: ' + err.message);
    }
}
window.initApp = initApp;

function clearOverlays() {
    weatherOverlays.forEach(o => o.setMap(null));
    weatherOverlays = [];
    routeMarkers.forEach(m => m.setMap(null));
    routeMarkers = [];
    altRenderers.forEach(r => r.setMap(null));
    altRenderers = [];
}

async function planTrip() {
    hideError();

    if (!originInput.value.trim()) {
        showError('Please enter a starting point.');
        return;
    }
    if (!destinationInput.value.trim()) {
        showError('Please enter a destination.');
        return;
    }
    if (!departureDateInput.value) {
        showError('Please select a departure date.');
        return;
    }

    planButton.disabled = true;
    planButton.textContent = 'Loading...';
    weatherTimeline.classList.remove('hidden');
    timelineCards.innerHTML = '<div class="loading">Calculating routes and fetching weather...</div>';

    try {
        const result = await getRoute(originInput.value, destinationInput.value);
        allRoutes = result;
        const departureDateTime = new Date(`${departureDateInput.value}T${departureTimeInput.value}:00`);

        const routeWeatherData = [];
        for (let r = 0; r < result.routes.length; r++) {
            const waypoints = sampleWaypoints(result, r, departureDateTime);
            const weatherData = await getWeatherForWaypoints(waypoints);
            const avgTemp = weatherData.reduce((s, w) => s + w.temperature, 0) / weatherData.length;
            const maxRain = Math.max(...weatherData.map(w => w.precipitationProb));
            const badWeatherCount = weatherData.filter(w => [55, 61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82, 85, 86, 95, 96, 99].includes(w.weatherCode)).length;
            routeWeatherData.push({ routeIndex: r, weatherData, avgTemp, maxRain, badWeatherCount });
        }

        routeWeatherData.sort((a, b) => a.badWeatherCount - b.badWeatherCount || a.maxRain - b.maxRain);

        displayRouteOptions(result, routeWeatherData, departureDateTime);
    } catch (err) {
        showError('Something went wrong: ' + err.message);
        weatherTimeline.classList.add('hidden');
    } finally {
        planButton.disabled = false;
        planButton.textContent = 'Go';
    }
}

function getRoute(origin, destination) {
    return new Promise((resolve, reject) => {
        const directionsService = new google.maps.DirectionsService();
        directionsService.route(
            {
                origin: origin,
                destination: destination,
                travelMode: google.maps.TravelMode.DRIVING,
                provideRouteAlternatives: true,
            },
            (result, status) => {
                if (status === 'OK') {
                    resolve(result);
                } else {
                    reject(new Error('Could not find a route. ' + status));
                }
            }
        );
    });
}

function sampleWaypoints(directionsResult, routeIndex, departureTime) {
    const route = directionsResult.routes[routeIndex];
    const leg = route.legs[0];
    const totalDuration = leg.duration.value;
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

        waypoints.push({
            lat: point.lat(),
            lon: point.lng(),
            arrivalTime,
            distanceMiles,
            isStart: i === 0,
            isEnd: i === numStops - 1,
        });
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
                const components = results[0].address_components;
                const city = components.find(c => c.types.includes('locality'));
                const county = components.find(c => c.types.includes('administrative_area_level_2'));
                resolve(city ? city.long_name : county ? county.long_name : results[0].formatted_address.split(',')[0]);
            } else {
                resolve(`${lat.toFixed(2)}, ${lon.toFixed(2)}`);
            }
        });
    });
}

async function getWeatherForWaypoints(waypoints) {
    const locationPromises = waypoints.map(wp => {
        if (wp.locationName) return Promise.resolve(wp.locationName);
        return reverseGeocode(wp.lat, wp.lon);
    });
    const locationNames = await Promise.all(locationPromises);

    const weatherPromises = waypoints.map(async (wp, i) => {
        const dateStr = wp.arrivalTime.toISOString().split('T')[0];
        const hour = wp.arrivalTime.getHours();
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${wp.lat}&longitude=${wp.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;

        const res = await fetch(url);
        const data = await res.json();
        const hourIndex = Math.min(hour, (data.hourly.time || []).length - 1);

        return {
            ...wp,
            locationName: locationNames[i],
            temperature: data.hourly.temperature_2m[hourIndex],
            humidity: data.hourly.relative_humidity_2m[hourIndex],
            precipitationProb: data.hourly.precipitation_probability[hourIndex],
            weatherCode: data.hourly.weathercode[hourIndex],
            windSpeed: data.hourly.windspeed_10m[hourIndex],
        };
    });

    return Promise.all(weatherPromises);
}

function weatherCodeToInfo(code) {
    const mapping = {
        0: { icon: '☀️', desc: 'Clear sky' },
        1: { icon: '🌤️', desc: 'Mainly clear' },
        2: { icon: '⛅', desc: 'Partly cloudy' },
        3: { icon: '☁️', desc: 'Overcast' },
        45: { icon: '🌫️', desc: 'Foggy' },
        48: { icon: '🌫️', desc: 'Freezing fog' },
        51: { icon: '🌦️', desc: 'Light drizzle' },
        53: { icon: '🌦️', desc: 'Moderate drizzle' },
        55: { icon: '🌧️', desc: 'Heavy drizzle' },
        61: { icon: '🌧️', desc: 'Light rain' },
        63: { icon: '🌧️', desc: 'Moderate rain' },
        65: { icon: '🌧️', desc: 'Heavy rain' },
        66: { icon: '❄️', desc: 'Freezing rain' },
        67: { icon: '❄️', desc: 'Heavy freezing rain' },
        71: { icon: '🌨️', desc: 'Light snow' },
        73: { icon: '🌨️', desc: 'Moderate snow' },
        75: { icon: '🌨️', desc: 'Heavy snow' },
        77: { icon: '❄️', desc: 'Snow grains' },
        80: { icon: '🌦️', desc: 'Light showers' },
        81: { icon: '🌧️', desc: 'Moderate showers' },
        82: { icon: '⛈️', desc: 'Violent showers' },
        85: { icon: '🌨️', desc: 'Light snow showers' },
        86: { icon: '🌨️', desc: 'Heavy snow showers' },
        95: { icon: '⚡', desc: 'Thunderstorm' },
        96: { icon: '⚡', desc: 'Thunderstorm with hail' },
        99: { icon: '⚡', desc: 'Thunderstorm with heavy hail' },
    };
    return mapping[code] || { icon: '❓', desc: 'Unknown' };
}

function getWeatherBreakdown(weatherData) {
    const total = weatherData.length;
    const sunny = weatherData.filter(w => [0, 1].includes(w.weatherCode)).length;
    const cloudy = weatherData.filter(w => [2, 3, 45, 48].includes(w.weatherCode)).length;
    const rainy = weatherData.filter(w => [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(w.weatherCode)).length;
    const snow = weatherData.filter(w => [66, 67, 71, 73, 75, 77, 85, 86].includes(w.weatherCode)).length;
    const storm = weatherData.filter(w => [95, 96, 99].includes(w.weatherCode)).length;

    const parts = [];
    if (sunny > 0) parts.push({ label: 'Clear', pct: Math.round(sunny / total * 100), color: '#f6e05e', icon: '☀️' });
    if (cloudy > 0) parts.push({ label: 'Cloudy', pct: Math.round(cloudy / total * 100), color: '#cbd5e0', icon: '☁️' });
    if (rainy > 0) parts.push({ label: 'Rain', pct: Math.round(rainy / total * 100), color: '#63b3ed', icon: '🌧️' });
    if (snow > 0) parts.push({ label: 'Snow', pct: Math.round(snow / total * 100), color: '#e2e8f0', icon: '🌨️' });
    if (storm > 0) parts.push({ label: 'Storm', pct: Math.round(storm / total * 100), color: '#fc8181', icon: '⚡' });
    return parts;
}

function displayRouteOptions(directionsResult, routeWeatherData, departureDateTime) {
    clearOverlays();
    timelineCards.innerHTML = '';
    weatherTimeline.classList.remove('hidden');

    const routeColors = ['#3182ce', '#d69e2e', '#9f7aea'];

    if (routeWeatherData.length > 1) {
        const routePicker = document.createElement('div');
        routePicker.className = 'route-picker';
        routePicker.innerHTML = '<h3>Choose a Route</h3>';

        routeWeatherData.forEach((rd, idx) => {
            const route = directionsResult.routes[rd.routeIndex];
            const leg = route.legs[0];
            const durationMin = Math.round(leg.duration.value / 60);
            const hours = Math.floor(durationMin / 60);
            const mins = durationMin % 60;
            const distMiles = (leg.distance.value / 1609.34).toFixed(0);
            const summary = route.summary || `Route ${idx + 1}`;
            const isBest = idx === 0;

            const renderer = new google.maps.DirectionsRenderer({
                map: map,
                directions: directionsResult,
                routeIndex: rd.routeIndex,
                suppressMarkers: true,
                polylineOptions: {
                    strokeColor: isBest ? routeColors[0] : '#a0aec0',
                    strokeWeight: isBest ? 5 : 3,
                    strokeOpacity: isBest ? 0.8 : 0.4,
                    zIndex: isBest ? 2 : 1,
                }
            });
            altRenderers.push(renderer);

            const btn = document.createElement('button');
            btn.className = `route-option ${isBest ? 'selected' : ''}`;

            let weatherLabel = '';
            if (rd.badWeatherCount === 0 && rd.maxRain <= 20) {
                weatherLabel = '<span class="weather-badge good">Best Weather</span>';
            } else if (rd.badWeatherCount > 0) {
                weatherLabel = `<span class="weather-badge bad">${rd.badWeatherCount} bad stretch${rd.badWeatherCount > 1 ? 'es' : ''}</span>`;
            } else if (rd.maxRain > 50) {
                weatherLabel = `<span class="weather-badge warn">Up to ${rd.maxRain}% rain</span>`;
            }

            const breakdown = getWeatherBreakdown(rd.weatherData);
            const barHtml = breakdown.map(b =>
                `<div style="flex:${b.pct};background:${b.color};height:100%;border-radius:3px;" title="${b.icon} ${b.label} ${b.pct}%"></div>`
            ).join('');
            const legendHtml = breakdown.map(b =>
                `<span style="font-size:0.75rem;color:#4a5568;">${b.icon} ${b.pct}%</span>`
            ).join(' ');

            btn.innerHTML = `
                <div class="route-number" style="background: ${routeColors[Math.min(idx, routeColors.length - 1)]}">${idx + 1}</div>
                <div class="route-option-content">
                    <div class="route-option-top">
                        <strong>via ${summary}</strong>
                        ${weatherLabel}
                    </div>
                    <div class="route-option-details">
                        ${hours > 0 ? hours + 'h ' : ''}${mins}min · ${distMiles} mi
                    </div>
                    <div style="display:flex;gap:2px;height:6px;margin-top:6px;border-radius:3px;overflow:hidden;">${barHtml}</div>
                    <div style="margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;">${legendHtml}</div>
                </div>
                <div class="route-check">
                    <svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
            `;

            btn.addEventListener('click', () => {
                document.querySelectorAll('.route-option').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');

                altRenderers.forEach(r => r.setMap(null));
                altRenderers = [];

                routeWeatherData.forEach((rd2, ri) => {
                    const isSelected = ri === idx;
                    const renderer = new google.maps.DirectionsRenderer({
                        map: map,
                        directions: directionsResult,
                        routeIndex: rd2.routeIndex,
                        suppressMarkers: true,
                        polylineOptions: {
                            strokeColor: isSelected ? routeColors[0] : '#a0aec0',
                            strokeWeight: isSelected ? 6 : 3,
                            strokeOpacity: isSelected ? 0.9 : 0.4,
                            zIndex: isSelected ? 10 : 1,
                        }
                    });
                    altRenderers.push(renderer);
                });

                showWeatherCards(rd.weatherData);
                showOverlaysOnMap(rd.weatherData);
            });

            routePicker.appendChild(btn);
        });

        timelineCards.appendChild(routePicker);
    }

    showWeatherCards(routeWeatherData[0].weatherData);
    showOverlaysOnMap(routeWeatherData[0].weatherData);

    if (routeWeatherData.length <= 1) {
        directionsRenderer.setDirections(directionsResult);
    }

    const bounds = new google.maps.LatLngBounds();
    routeWeatherData[0].weatherData.forEach(wp => {
        bounds.extend(new google.maps.LatLng(wp.lat, wp.lon));
    });
    map.fitBounds(bounds, { top: 80, left: 340, right: 40, bottom: 40 });
}

function showOverlaysOnMap(weatherData) {
    weatherOverlays.forEach(o => o.setMap(null));
    weatherOverlays = [];
    routeMarkers.forEach(m => m.setMap(null));
    routeMarkers = [];

    weatherData.forEach((wp, i) => {
        const info = weatherCodeToInfo(wp.weatherCode);
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const cardClass = wp.isStart ? 'start' : wp.isEnd ? 'end' : '';

        const overlayHtml = `
            <div class="weather-overlay ${cardClass}">
                <div class="overlay-icon">${info.icon}</div>
                <div class="overlay-temp">${Math.round(wp.temperature)}°F</div>
                <div class="overlay-label">${wp.locationName}</div>
                <div class="overlay-time">${timeStr}</div>
            </div>
        `;

        const position = new google.maps.LatLng(wp.lat, wp.lon);
        const overlay = new WeatherOverlay(position, overlayHtml, map);
        weatherOverlays.push(overlay);

        const marker = new google.maps.Marker({
            position: { lat: wp.lat, lng: wp.lon },
            map: map,
            opacity: 0,
            zIndex: 0,
        });

        const dateStr = wp.arrivalTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const infoContent = `
            <div style="font-family: sans-serif; min-width: 180px;">
                <h3 style="margin:0 0 6px 0; font-size:1rem;">${wp.locationName}</h3>
                <p style="margin:0; font-size:0.85rem; color:#666;">${timeStr} · ${dateStr}</p>
                <p style="margin:6px 0; font-size:1.3rem;">${info.icon} ${Math.round(wp.temperature)}°F — ${info.desc}</p>
                <p style="margin:0; font-size:0.8rem; color:#888;">
                    Wind: ${Math.round(wp.windSpeed)} mph · Rain: ${wp.precipitationProb}% · Humidity: ${wp.humidity}%
                </p>
            </div>
        `;
        const infoWindow = new google.maps.InfoWindow({ content: infoContent });
        marker.addListener('click', () => infoWindow.open({ anchor: marker, map }));
        routeMarkers.push(marker);
    });
}

function showWeatherCards(weatherData) {
    let cardsContainer = document.getElementById('weather-cards-list');
    if (cardsContainer) {
        cardsContainer.innerHTML = '';
    } else {
        cardsContainer = document.createElement('div');
        cardsContainer.id = 'weather-cards-list';
        timelineCards.appendChild(cardsContainer);
    }

    weatherData.forEach((wp, i) => {
        const info = weatherCodeToInfo(wp.weatherCode);
        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = wp.arrivalTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const label = wp.isStart ? 'Departure' : wp.isEnd ? 'Arrival' : `${wp.distanceMiles} mi`;
        const cardClass = wp.isStart ? 'start' : wp.isEnd ? 'end' : '';

        const card = document.createElement('div');
        card.className = `weather-card ${cardClass}`;
        card.innerHTML = `
            <div class="time-info">
                <div class="location-name">${wp.locationName}</div>
                <div class="arrival-time">${timeStr} · ${dateStr}</div>
                <div class="arrival-time">${label}</div>
            </div>
            <div class="weather-icon">${info.icon}</div>
            <div class="weather-details">
                <div class="temp">${Math.round(wp.temperature)}°F</div>
                <div class="description">${info.desc}</div>
                <div class="extra">
                    Wind: ${Math.round(wp.windSpeed)} mph ·
                    Rain: ${wp.precipitationProb}% ·
                    Humidity: ${wp.humidity}%
                </div>
            </div>
        `;
        card.addEventListener('click', () => {
            map.panTo({ lat: wp.lat, lng: wp.lon });
            map.setZoom(10);
            setTimeout(() => {
                const marker = routeMarkers[i];
                if (marker) {
                    google.maps.event.trigger(marker, 'click');
                }
            }, 300);
        });
        card.style.cursor = 'pointer';
        cardsContainer.appendChild(card);
    });
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}
