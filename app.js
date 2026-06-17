const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const originSuggestions = document.getElementById('origin-suggestions');
const destinationSuggestions = document.getElementById('destination-suggestions');
const departureDateInput = document.getElementById('departure-date');
const departureTimeInput = document.getElementById('departure-time');
const planButton = document.getElementById('plan-trip');
const errorMessage = document.getElementById('error-message');
const resultsSection = document.getElementById('results');
const timelineCards = document.getElementById('timeline-cards');

let map = null;
let routeLayer = null;
let markersLayer = null;
let originCoords = null;
let destinationCoords = null;

const today = new Date();
departureDateInput.value = today.toISOString().split('T')[0];
departureDateInput.min = today.toISOString().split('T')[0];
const maxDate = new Date(today);
maxDate.setDate(maxDate.getDate() + 14);
departureDateInput.max = maxDate.toISOString().split('T')[0];

let debounceTimer = null;

function setupAutocomplete(input, suggestionsEl, setCoords) {
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value.trim();
        if (query.length < 3) {
            suggestionsEl.classList.remove('active');
            return;
        }
        debounceTimer = setTimeout(() => geocodeSearch(query, suggestionsEl, input, setCoords), 300);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestionsEl.contains(e.target)) {
            suggestionsEl.classList.remove('active');
        }
    });
}

async function geocodeSearch(query, suggestionsEl, input, setCoords) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
    try {
        const res = await fetch(url, {
            headers: { 'Accept-Language': 'en' }
        });
        const data = await res.json();
        suggestionsEl.innerHTML = '';
        if (data.length === 0) {
            suggestionsEl.classList.remove('active');
            return;
        }
        data.forEach(place => {
            const li = document.createElement('li');
            li.textContent = place.display_name;
            li.addEventListener('click', () => {
                input.value = place.display_name;
                setCoords({ lat: parseFloat(place.lat), lon: parseFloat(place.lon), name: place.display_name.split(',')[0] });
                suggestionsEl.classList.remove('active');
            });
            suggestionsEl.appendChild(li);
        });
        suggestionsEl.classList.add('active');
    } catch {
        suggestionsEl.classList.remove('active');
    }
}

setupAutocomplete(originInput, originSuggestions, (coords) => { originCoords = coords; });
setupAutocomplete(destinationInput, destinationSuggestions, (coords) => { destinationCoords = coords; });

planButton.addEventListener('click', planTrip);

async function planTrip() {
    hideError();

    if (!originCoords) {
        showError('Please select a starting point from the suggestions.');
        return;
    }
    if (!destinationCoords) {
        showError('Please select a destination from the suggestions.');
        return;
    }
    if (!departureDateInput.value) {
        showError('Please select a departure date.');
        return;
    }

    planButton.disabled = true;
    planButton.textContent = 'Planning...';
    resultsSection.classList.remove('hidden');
    timelineCards.innerHTML = '<div class="loading">Calculating route and fetching weather...</div>';

    try {
        const route = await getRoute(originCoords, destinationCoords);
        const departureDateTime = new Date(`${departureDateInput.value}T${departureTimeInput.value}:00`);
        const waypoints = sampleWaypoints(route, departureDateTime);
        const weatherData = await getWeatherForWaypoints(waypoints);
        displayResults(route, weatherData);
    } catch (err) {
        showError('Something went wrong: ' + err.message);
        resultsSection.classList.add('hidden');
    } finally {
        planButton.disabled = false;
        planButton.textContent = 'Plan My Trip';
    }
}

async function getRoute(origin, dest) {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes.length) {
        throw new Error('Could not find a route between these locations.');
    }
    return data.routes[0];
}

function sampleWaypoints(route, departureTime) {
    const coords = route.geometry.coordinates;
    const totalDuration = route.duration;
    const totalDistance = route.distance;
    const numStops = Math.min(Math.max(Math.ceil(totalDuration / 3600), 3), 12);

    const waypoints = [];

    for (let i = 0; i < numStops; i++) {
        const fraction = i / (numStops - 1);
        const coordIndex = Math.min(Math.floor(fraction * (coords.length - 1)), coords.length - 1);
        const [lon, lat] = coords[coordIndex];
        const elapsedSeconds = fraction * totalDuration;
        const arrivalTime = new Date(departureTime.getTime() + elapsedSeconds * 1000);
        const distanceKm = (fraction * totalDistance / 1000).toFixed(0);

        waypoints.push({
            lat,
            lon,
            arrivalTime,
            distanceKm,
            isStart: i === 0,
            isEnd: i === numStops - 1,
        });
    }

    return waypoints;
}

async function reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    try {
        const res = await fetch(url, {
            headers: { 'Accept-Language': 'en' }
        });
        const data = await res.json();
        if (data.address) {
            return data.address.city || data.address.town || data.address.village || data.address.county || 'Unknown';
        }
    } catch { /* ignore */ }
    return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

async function getWeatherForWaypoints(waypoints) {
    const results = [];

    const locationNames = await Promise.all(
        waypoints.map(wp => {
            if (wp.isStart && originCoords) return Promise.resolve(originCoords.name);
            if (wp.isEnd && destinationCoords) return Promise.resolve(destinationCoords.name);
            return reverseGeocode(wp.lat, wp.lon);
        })
    );

    const weatherPromises = waypoints.map(async (wp, i) => {
        const dateStr = wp.arrivalTime.toISOString().split('T')[0];
        const hour = wp.arrivalTime.getHours();
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${wp.lat}&longitude=${wp.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weathercode,windspeed_10m&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;

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

function displayResults(route, weatherData) {
    if (!map) {
        map = L.map('map');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
    }

    if (routeLayer) map.removeLayer(routeLayer);
    if (markersLayer) map.removeLayer(markersLayer);

    const routeCoords = route.geometry.coordinates.map(c => [c[1], c[0]]);
    routeLayer = L.polyline(routeCoords, { color: '#3182ce', weight: 4, opacity: 0.8 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });

    markersLayer = L.layerGroup().addTo(map);

    timelineCards.innerHTML = '';

    weatherData.forEach((wp) => {
        const info = weatherCodeToInfo(wp.weatherCode);

        const markerColor = wp.isStart ? 'green' : wp.isEnd ? 'red' : 'blue';
        const markerIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background:${markerColor};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
        });

        const marker = L.marker([wp.lat, wp.lon], { icon: markerIcon }).addTo(markersLayer);
        marker.bindPopup(`<b>${wp.locationName}</b><br>${info.icon} ${info.desc}<br>${Math.round(wp.temperature)}°C`);

        const card = document.createElement('div');
        const cardClass = wp.isStart ? 'start' : wp.isEnd ? 'end' : '';
        card.className = `weather-card ${cardClass}`;

        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = wp.arrivalTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const label = wp.isStart ? 'Departure' : wp.isEnd ? 'Arrival' : `${wp.distanceKm} km`;

        card.innerHTML = `
            <div class="time-info">
                <div class="location-name">${wp.locationName}</div>
                <div class="arrival-time">${timeStr} • ${dateStr}</div>
                <div class="arrival-time">${label}</div>
            </div>
            <div class="weather-icon">${info.icon}</div>
            <div class="weather-details">
                <div class="temp">${Math.round(wp.temperature)}°C</div>
                <div class="description">${info.desc}</div>
                <div class="extra">
                    Wind: ${Math.round(wp.windSpeed)} km/h •
                    Rain: ${wp.precipitationProb}% •
                    Humidity: ${wp.humidity}%
                </div>
            </div>
        `;

        timelineCards.appendChild(card);
    });
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}
