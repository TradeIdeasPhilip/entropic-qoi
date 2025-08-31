import * as d3 from "d3";

export function makeHistogram(
  frequencies: ReadonlyMap<number, number>,
  yMax: number | undefined = 20000
) {
  // Declare the chart dimensions and margins.
  const width = 928;
  const height = 500;
  const marginTop = 30;
  const marginRight = 10;
  const marginBottom = 30;
  const marginLeft = 80;

  // Convert Map to array of objects for D3.
  const data = Array.from(frequencies, ([key, frequency]) => ({
    key, // Keep key as number
    frequency,
  }));

  // Declare the x (horizontal position) scale, casting keys to strings for D3.
  const x = d3
    .scaleBand<string>()
    .domain(data.map((d) => String(d.key))) // Convert number to string for domain
    .range([marginLeft, width - marginRight])
    .padding(0.1);

  // Declare the y (vertical position) scale.
  const y = d3
    .scaleLinear()
    .domain([0, yMax ?? d3.max(data, (d) => d.frequency) ?? 1]) // Use yMax if provided, else fallback to max or 1
    .range([height - marginBottom, marginTop])
    .nice(); // Round domain for better ticks

  // Create the SVG container.
  const svg = d3
    .create("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "max-width: 100%; height: auto;");

  // Create a tooltip div
  const tooltip = d3
    .select("body")
    .append("div")
    .attr("class", "tooltip")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background", "#fff")
    .style("border", "1px solid #ccc")
    .style("padding", "5px")
    .style("border-radius", "3px");

  // Add a rect for each bar.
  svg
    .append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("fill", (d) =>
      d.frequency === 0
        ? "transparent"
        : d.frequency < 1000
        ? "#d3d3d3"
        : "steelblue"
    ) // Differentiate empty and small bins
    .attr("x", (d) => x(String(d.key))!) // Cast key to string for x-scale
    .attr("y", (d) => y(Math.max(d.frequency, 1e-6))) // Ensure small bins are visible
    .attr("height", (d) => y(0) - y(Math.max(d.frequency, 1e-6)))
    .attr("width", x.bandwidth())
    .on("mouseover", function (_event, d) {
      // Remove unused 'event' parameter
      d3.select(this).attr("fill", "orange"); // Highlight on hover
      tooltip
        .style("visibility", "visible")
        .text(`Value: ${d.key}, Count: ${d.frequency.toLocaleString()}`);
    })
    .on("mousemove", function (event) {
      tooltip
        .style("top", `${event.pageY - 10}px`)
        .style("left", `${event.pageX + 10}px`);
    });
  /*
    .on("mouseout", function (this: SVGRectElement) {
      d3.select(this as SVGRectElement).attr("fill", (d:{ key: number; frequency: number; }) =>
        d.frequency === 0 ? "transparent" : d.frequency < 1000 ? "#d3d3d3" : "steelblue"
      );
      tooltip.style("visibility", "hidden");
    });
    */
  // Add the x-axis and label, showing every 16th tick.
  svg
    .append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(
          data.map((d) => String(d.key)).filter((_, i) => i % 16 === 0)
        ) // Every 16th tick, cast to string
        .tickSizeOuter(0)
    )
    .call((g) =>
      g
        .append("text")
        .attr("x", width - marginRight)
        .attr("y", marginBottom - 5)
        .attr("fill", "currentColor")
        .attr("text-anchor", "end")
        .text("Value")
    );

  // Add the y-axis and label with commas.
  svg
    .append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .call(
      d3.axisLeft(y).tickFormat((y) =>
        (Number(y) * 100).toLocaleString("en-US", {
          maximumFractionDigits: 0,
        })
      )
    )
    .call((g) => g.select(".domain").remove())
    .call((g) =>
      g
        .append("text")
        .attr("x", -marginLeft)
        .attr("y", 10)
        .attr("fill", "currentColor")
        .attr("text-anchor", "start")
        .text("Count")
    );

  // Return the SVG element.
  return svg.node();
}
