# 🏠 Home Insulation & Energy Performance Simulator

<div align="center">
  <img src="favicon.jpeg" alt="Energy Simulator Favicon" width="64" height="64" style="border-radius: 8px;">
  <br>
  <strong>Advanced energy modeling tool for residential building performance analysis</strong>
</div>

---

## 📊 Overview

The **Home Insulation & Energy Performance Simulator** is a sophisticated web-based tool that provides detailed energy modeling and analysis for residential buildings. Built with modern web technologies, it offers transparent, comparative energy performance calculations to help homeowners, builders, and energy professionals make informed decisions about building envelope improvements.

**Version:** 1.2.0  
**Status:** Production Ready

## ✨ Key Features

### 🏗️ **Building Envelope Modeling**

- **Wall Construction Analysis**: 2x4 and 2x6 framing options with various insulation types
- **Insulation Types**: Fiberglass, Mineral Wool, Open/Closed-Cell Spray Foam, Flash & Batt
- **Exterior Sheathing**: OSB, ZIP System, and insulated sheathing options (R-3, R-6)
- **Thermal Bridging**: Interior polyiso thermal break calculations

### 🌡️ **Climate & Load Calculations**

- **Heating Degree Days (HDD65)**: Customizable climate data
- **Cooling Degree Days (CDD65)**: Summer cooling load analysis
- **Conduction Loads**: U-value based calculations with whole-wall effective R-values
- **Infiltration Loads**: Air leakage modeling with customizable ACH50 presets

### 💰 **Economic Analysis**

- **Energy Cost Calculations**: Electricity and gas pricing
- **HVAC Efficiency**: Heat pump COP and SEER ratings
- **Annual Operating Costs**: Detailed breakdown of heating/cooling expenses
- **ROI Analysis**: Cost-benefit evaluation of insulation upgrades

### 📈 **Performance Metrics**

- **HERS Index Estimation**: Home Energy Rating System calculations
- **Energy Consumption**: Annual kWh requirements
- **Carbon Footprint**: Environmental impact assessment
- **Comparative Analysis**: Rated vs. Reference building performance

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ or **Bun** 1.0+
- Modern web browser

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/energy-sim-vite.git
cd energy-sim-vite

# Install dependencies (using Bun - recommended)
bun install

# Or using npm
npm install
```

### Development

```bash
# Start development server
bun run dev

# Or using npm
npm run dev
```

The application will be available at `http://localhost:5173`

### Production Build

```bash
# Build for production
bun run build

# Preview production build
bun run preview
```

## 🐳 Docker Deployment

```bash
# Build Docker image
docker build -t energy-sim .

# Run container
docker run -p 8080:80 energy-sim
```

The application will be available at `http://localhost:8080`

## 🏗️ Architecture

### Technology Stack

- **Frontend**: React 18 with modern hooks
- **Build Tool**: Vite 5 for fast development and optimized builds
- **Styling**: Tailwind CSS for responsive design
- **Charts**: Recharts for data visualization
- **Runtime**: Bun for fast package management and execution

### Core Components

- **Energy Calculator**: Main simulation engine with physics-based calculations
- **UI Components**: Interactive forms and real-time results display
- **Data Visualization**: Charts and graphs for performance metrics
- **Validation Engine**: Built-in unit tests and sanity checks

## 📚 Usage Examples

### Basic Wall Analysis

```javascript
// Example wall configuration
const wallConfig = {
  framingDepthIn: 5.5, // 2x6 construction
  cavityInsulationKey: "ccspf", // Closed-cell spray foam
  exteriorSheathingKey: "zipr3", // R-3 insulated sheathing
  interiorPolyiso: true, // Interior thermal break
  framingFactor: 0.23, // 23% framing factor
};

// Calculate whole-wall R-value
const { rEff, rStudPath, rCavityPath } = calcWholeWallR(wallConfig);
```

### Climate Data Configuration

```javascript
const climateData = {
  locationName: "Fuquay-Varina, NC (CZ4)",
  HDD65: 3450, // Heating Degree Days
  CDD65: 1730, // Cooling Degree Days
};
```

## 🔬 Technical Details

### Energy Calculation Formulas

#### Conduction Load

```
Q = U × A × DD × 24 [BTU/yr]
```

Where:

- `U` = Overall heat transfer coefficient (BTU/hr·ft²·°F)
- `A` = Surface area (ft²)
- `DD` = Degree days (°F·days)
- `24` = Hours per day

#### Infiltration Load

```
Q = 0.432 × ACH_nat × Volume × DD [BTU/yr]
```

Where:

- `ACH_nat` = Natural air changes per hour
- `Volume` = Conditioned volume (ft³)

#### HERS Index

```
HERS Index = 100 × (Rated site energy / Reference site energy)
```

### Built-in Validation

The simulator includes comprehensive unit tests and sanity checks for:

- Core mathematical calculations
- HERS estimator accuracy
- Energy load calculations
- Thermal bridging effects

## 📱 Browser Support

- **Chrome** 90+
- **Firefox** 88+
- **Safari** 14+
- **Edge** 90+

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

**This tool is designed for educational and comparative purposes only.** It provides transparent energy modeling but is not intended for stamped compliance or official energy certification. Always consult with qualified energy professionals for compliance-related decisions.

## 🔗 Related Links

- [Energy Star Guidelines](https://www.energystar.gov/)
- [HERS Index Information](https://www.hersindex.com/)
- [Building Science Resources](https://buildingscience.com/)

---

<div align="center">
  <sub>Built with ❤️ using React, Vite, and Tailwind CSS</sub>
</div>
