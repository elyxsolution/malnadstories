/**
 * Popular travel destinations — a curated, predefined dataset (~300 entries) powering the cover
 * title/location autocomplete. PURE data, no I/O. Indian destinations first (the primary market —
 * cities, hill stations, beaches, heritage, wildlife, incl. the Malnad/Karnataka region), then
 * popular international destinations. Suggestions are advisory; the cover title stays free text.
 */
export const LOCATIONS: string[] = [
  // ── India — major cities ──────────────────────────────────────────────────
  'Bangalore', 'Bengaluru', 'Mumbai', 'Delhi', 'New Delhi', 'Chennai', 'Kolkata', 'Hyderabad',
  'Pune', 'Ahmedabad', 'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Bhopal',
  'Visakhapatnam', 'Patna', 'Vadodara', 'Coimbatore', 'Kochi', 'Thiruvananthapuram', 'Chandigarh',
  'Guwahati', 'Bhubaneswar', 'Mysore', 'Mysuru', 'Mangalore', 'Mangaluru', 'Hubli', 'Belgaum',
  // ── India — Karnataka / Malnad region ───────────────────────────────────────
  'Chikkamagaluru', 'Chikmagalur', 'Sakleshpur', 'Kemmanagundi', 'Kudremukh', 'Mullayanagiri',
  'Baba Budangiri', 'Agumbe', 'Kalasa', 'Horanadu', 'Sringeri', 'Kollur', 'Jog Falls', 'Sirsi',
  'Yellapur', 'Dandeli', 'Coorg', 'Kodagu', 'Madikeri', 'Talakaveri', 'Hampi', 'Badami', 'Aihole',
  'Pattadakal', 'Bijapur', 'Vijayapura', 'Gokarna', 'Murudeshwar', 'Karwar', 'Udupi', 'Shivamogga',
  'Shimoga', 'Chitradurga', 'Hassan', 'Belur', 'Halebidu', 'Shravanabelagola', 'Nandi Hills',
  'Bandipur', 'Nagarhole', 'BR Hills', 'Kabini', 'Bheemeshwari',
  // ── India — hill stations ───────────────────────────────────────────────────
  'Ooty', 'Kodaikanal', 'Munnar', 'Wayanad', 'Coonoor', 'Yercaud', 'Vagamon', 'Ponmudi',
  'Shimla', 'Manali', 'Dharamshala', 'McLeod Ganj', 'Dalhousie', 'Kasauli', 'Kufri', 'Kasol',
  'Spiti Valley', 'Kinnaur', 'Mussoorie', 'Nainital', 'Mukteshwar', 'Ranikhet', 'Almora', 'Auli',
  'Lansdowne', 'Chopta', 'Darjeeling', 'Kalimpong', 'Gangtok', 'Pelling', 'Lachung', 'Tawang',
  'Shillong', 'Cherrapunji', 'Mount Abu', 'Lonavala', 'Mahabaleshwar', 'Panchgani', 'Matheran',
  'Saputara', 'Araku Valley',
  // ── India — beaches & coast ─────────────────────────────────────────────────
  'Goa', 'North Goa', 'South Goa', 'Panaji', 'Calangute', 'Baga', 'Anjuna', 'Palolem', 'Vagator',
  'Varkala', 'Kovalam', 'Alleppey', 'Alappuzha', 'Kumarakom', 'Marari', 'Pondicherry', 'Puducherry',
  'Mahabalipuram', 'Rameswaram', 'Kanyakumari', 'Tarkarli', 'Diu', 'Andaman Islands', 'Havelock Island',
  'Neil Island', 'Port Blair', 'Lakshadweep',
  // ── India — heritage & landmarks ────────────────────────────────────────────
  'Agra', 'Taj Mahal', 'Fatehpur Sikri', 'Varanasi', 'Banaras', 'Kashi', 'Sarnath', 'Bodh Gaya',
  'Khajuraho', 'Orchha', 'Gwalior', 'Ujjain', 'Konark', 'Puri', 'Amritsar', 'Golden Temple',
  'Rishikesh', 'Haridwar', 'Udaipur', 'Jodhpur', 'Jaisalmer', 'Bikaner', 'Pushkar', 'Ajmer',
  'Mount Girnar', 'Somnath', 'Dwarka', 'Rann of Kutch', 'Bhuj', 'Hampi Bazaar', 'Mahabalipuram Shore Temple',
  // ── India — nature, wildlife & valleys ──────────────────────────────────────
  'Jim Corbett', 'Ranthambore', 'Kaziranga', 'Sundarbans', 'Gir National Park', 'Periyar', 'Thekkady',
  'Valley of Flowers', 'Hemkund Sahib', 'Kedarnath', 'Badrinath', 'Gangotri', 'Yamunotri', 'Leh',
  'Ladakh', 'Nubra Valley', 'Pangong Lake', 'Tso Moriri', 'Zanskar', 'Srinagar', 'Gulmarg',
  'Pahalgam', 'Sonamarg', 'Dal Lake', 'Kasol Parvati Valley', 'Ziro Valley', 'Majuli',
  // ── India — states & regions ────────────────────────────────────────────────
  'Karnataka', 'Kerala', 'Tamil Nadu', 'Rajasthan', 'Himachal Pradesh', 'Uttarakhand', 'Sikkim',
  'Meghalaya', 'Assam', 'Arunachal Pradesh', 'Maharashtra', 'Gujarat', 'Madhya Pradesh', 'Odisha',
  'Punjab', 'Andhra Pradesh', 'Telangana', 'West Bengal', 'Jammu and Kashmir', 'Northeast India',
  'Western Ghats', 'Himalayas',

  // ── International — Asia ─────────────────────────────────────────────────────
  'Bali', 'Ubud', 'Jakarta', 'Bangkok', 'Phuket', 'Krabi', 'Chiang Mai', 'Pattaya', 'Singapore',
  'Kuala Lumpur', 'Langkawi', 'Penang', 'Hanoi', 'Ho Chi Minh City', 'Ha Long Bay', 'Da Nang',
  'Siem Reap', 'Angkor Wat', 'Phnom Penh', 'Luang Prabang', 'Yangon', 'Bagan', 'Tokyo', 'Kyoto',
  'Osaka', 'Hokkaido', 'Mount Fuji', 'Seoul', 'Busan', 'Jeju Island', 'Beijing', 'Shanghai',
  'Hong Kong', 'Macau', 'Taipei', 'Colombo', 'Kandy', 'Galle', 'Sigiriya', 'Ella', 'Nuwara Eliya',
  'Kathmandu', 'Pokhara', 'Everest Base Camp', 'Thimphu', 'Paro', 'Malé', 'Maldives', 'Dubai',
  'Abu Dhabi', 'Doha', 'Muscat', 'Istanbul', 'Cappadocia', 'Antalya', 'Petra', 'Jerusalem',
  'Tel Aviv', 'Tashkent', 'Samarkand', 'Baku',
  // ── International — Europe ───────────────────────────────────────────────────
  'Paris', 'Eiffel Tower', 'Nice', 'French Riviera', 'London', 'Edinburgh', 'Amsterdam', 'Rome',
  'Venice', 'Florence', 'Milan', 'Naples', 'Amalfi Coast', 'Tuscany', 'Cinque Terre', 'Barcelona',
  'Madrid', 'Seville', 'Granada', 'Lisbon', 'Porto', 'Berlin', 'Munich', 'Hamburg', 'Vienna',
  'Salzburg', 'Hallstatt', 'Prague', 'Budapest', 'Zurich', 'Geneva', 'Interlaken', 'Zermatt',
  'Lucerne', 'Santorini', 'Mykonos', 'Athens', 'Dubrovnik', 'Split', 'Reykjavik', 'Oslo', 'Bergen',
  'Stockholm', 'Copenhagen', 'Helsinki', 'Brussels', 'Bruges', 'Dublin', 'Moscow', 'Saint Petersburg',
  'Krakow', 'Warsaw', 'Lapland',
  // ── International — Americas ─────────────────────────────────────────────────
  'New York', 'New York City', 'Los Angeles', 'San Francisco', 'Las Vegas', 'Miami', 'Chicago',
  'Washington DC', 'Boston', 'Seattle', 'Orlando', 'Grand Canyon', 'Yellowstone', 'Hawaii', 'Honolulu',
  'Toronto', 'Vancouver', 'Montreal', 'Banff', 'Niagara Falls', 'Mexico City', 'Cancun', 'Tulum',
  'Havana', 'Rio de Janeiro', 'São Paulo', 'Buenos Aires', 'Patagonia', 'Machu Picchu', 'Cusco',
  'Lima', 'Cartagena', 'Galápagos Islands',
  // ── International — Africa & Oceania ─────────────────────────────────────────
  'Cape Town', 'Johannesburg', 'Kruger National Park', 'Serengeti', 'Maasai Mara', 'Nairobi',
  'Zanzibar', 'Marrakech', 'Casablanca', 'Cairo', 'Giza Pyramids', 'Luxor', 'Victoria Falls',
  'Mauritius', 'Seychelles', 'Sydney', 'Melbourne', 'Gold Coast', 'Great Barrier Reef', 'Cairns',
  'Auckland', 'Queenstown', 'Wellington', 'Fiji', 'Bora Bora', 'Tahiti',
];
