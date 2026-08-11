#!/usr/bin/env python
"""
MCP Server for PowerPoint manipulation using python-pptx.
Consolidated version with 20 tools organized into multiple modules.
"""
import os
import argparse
from typing import Dict, Any
from mcp.server.fastmcp import FastMCP

# import utils  # Currently unused
from tools import (
    register_presentation_tools,
    register_content_tools,
    register_structural_tools,
    register_professional_tools,
    register_template_tools,
    register_hyperlink_tools,
    register_chart_tools,
    register_connector_tools,
    register_master_tools,
    register_transition_tools
)

# Initialize the FastMCP server
app = FastMCP(
    name="ppt-mcp-server"
)

# Gies: per-user scoped state (see gies_state.py). Replaces the shared dict and
# the single current_presentation_id global so concurrent users are isolated.
# get_current_presentation_id is passed into the register_*_tools calls below.
from gies_state import ScopedPresentations, get_current_presentation_id
presentations = ScopedPresentations()

# Template configuration
def get_template_search_directories():
    """
    Get list of directories to search for templates.
    Uses environment variable PPT_TEMPLATE_PATH if set, otherwise uses default directories.
    
    Returns:
        List of directories to search for templates
    """
    template_env_path = os.environ.get('PPT_TEMPLATE_PATH')
    
    if template_env_path:
        # If environment variable is set, use it as the primary template directory
        # Support multiple paths separated by colon (Unix) or semicolon (Windows)
        import platform
        separator = ';' if platform.system() == "Windows" else ':'
        env_dirs = [path.strip() for path in template_env_path.split(separator) if path.strip()]
        
        # Verify that the directories exist
        valid_env_dirs = []
        for dir_path in env_dirs:
            expanded_path = os.path.expanduser(dir_path)
            if os.path.exists(expanded_path) and os.path.isdir(expanded_path):
                valid_env_dirs.append(expanded_path)
        
        if valid_env_dirs:
            # Add default fallback directories
            return valid_env_dirs + ['.', './templates', './assets', './resources']
        else:
            print(f"Warning: PPT_TEMPLATE_PATH directories not found: {template_env_path}")
    
    # Default search directories when no environment variable or invalid paths
    return ['.', './templates', './assets', './resources']

# ---- Helper Functions ----

def validate_parameters(params):
    """
    Validate parameters against constraints.
    
    Args:
        params: Dictionary of parameter name: (value, constraints) pairs
        
    Returns:
        (True, None) if all valid, or (False, error_message) if invalid
    """
    for param_name, (value, constraints) in params.items():
        for constraint_func, error_msg in constraints:
            if not constraint_func(value):
                return False, f"Parameter '{param_name}': {error_msg}"
    return True, None

def is_positive(value):
    """Check if a value is positive."""
    return value > 0

def is_non_negative(value):
    """Check if a value is non-negative."""
    return value >= 0

def is_in_range(min_val, max_val):
    """Create a function that checks if a value is in a range."""
    return lambda x: min_val <= x <= max_val

def is_in_list(valid_list):
    """Create a function that checks if a value is in a list."""
    return lambda x: x in valid_list

def is_valid_rgb(color_list):
    """Check if a color list is a valid RGB tuple."""
    if not isinstance(color_list, list) or len(color_list) != 3:
        return False
    return all(isinstance(c, int) and 0 <= c <= 255 for c in color_list)

def add_shape_direct(slide, shape_type: str, left: float, top: float, width: float, height: float) -> Any:
    """
    Add an auto shape to a slide using direct integer values instead of enum objects.
    
    This implementation provides a reliable alternative that bypasses potential 
    enum-related issues in the python-pptx library.
    
    Args:
        slide: The slide object
        shape_type: Shape type string (e.g., 'rectangle', 'oval', 'triangle')
        left: Left position in inches
        top: Top position in inches
        width: Width in inches
        height: Height in inches
        
    Returns:
        The created shape
    """
    from pptx.util import Inches
    
    # Direct mapping of shape types to their integer values
    # Values from MSO_AUTO_SHAPE_TYPE enum: https://github.com/scanny/python-pptx/blob/master/src/pptx/enum/shapes.py
    shape_type_map = {
        'rectangle': 1,              # RECTANGLE
        'rounded_rectangle': 5,      # ROUNDED_RECTANGLE
        'oval': 9,                   # OVAL
        'diamond': 4,                # DIAMOND
        'triangle': 7,               # ISOSCELES_TRIANGLE
        'right_triangle': 8,         # RIGHT_TRIANGLE
        'pentagon': 51,              # PENTAGON
        'hexagon': 10,               # HEXAGON
        'heptagon': 145,             # HEPTAGON
        'octagon': 6,                # OCTAGON
        'star': 92,                  # STAR_5_POINT
        'arrow': 33,                 # RIGHT_ARROW
        'cloud': 179,                # CLOUD
        'heart': 21,                 # HEART
        'lightning_bolt': 22,        # LIGHTNING_BOLT
        'sun': 23,                   # SUN
        'moon': 24,                  # MOON
        'smiley_face': 17,           # SMILEY_FACE
        'no_symbol': 19,             # NO_SYMBOL
        'flowchart_process': 61,     # FLOWCHART_PROCESS
        'flowchart_decision': 63,    # FLOWCHART_DECISION
        'flowchart_data': 64,        # FLOWCHART_DATA
        'flowchart_document': 67     # FLOWCHART_DOCUMENT
    }
    
    # Check if shape type is valid before trying to use it
    shape_type_lower = str(shape_type).lower()
    if shape_type_lower not in shape_type_map:
        available_shapes = ', '.join(sorted(shape_type_map.keys()))
        raise ValueError(f"Unsupported shape type: '{shape_type}'. Available shape types: {available_shapes}")
    
    # Get the integer value for the shape type
    shape_value = shape_type_map[shape_type_lower]
    
    # Create the shape using the direct integer value
    try:
        # The integer value is passed directly to add_shape
        shape = slide.shapes.add_shape(
            shape_value, Inches(left), Inches(top), Inches(width), Inches(height)
        )
        return shape
    except Exception as e:
        raise ValueError(f"Failed to create '{shape_type}' shape using direct value {shape_value}: {str(e)}")

# ---- Register Tools ----

# Register all tool modules
register_presentation_tools(
    app, 
    presentations, 
    get_current_presentation_id, 
    get_template_search_directories
)

register_content_tools(
    app,
    presentations,
    get_current_presentation_id,
    validate_parameters,
    is_positive,
    is_non_negative,
    is_in_range,
    is_valid_rgb
)

register_structural_tools(
    app,
    presentations,
    get_current_presentation_id,
    validate_parameters,
    is_positive,
    is_non_negative,
    is_in_range,
    is_valid_rgb,
    add_shape_direct
)

register_professional_tools(
    app,
    presentations,
    get_current_presentation_id
)

register_template_tools(
    app,
    presentations,
    get_current_presentation_id
)

# Gies: dropped hyperlink/connector/master/transition modules to keep the tool
# set lean for the model (see plan Task 6). Kept: presentation, content,
# structural, professional, template, chart.

# Gies: pre-build question card + creation gate (see gies_questions.py).
from gies_questions import register_question_tools
register_question_tools(app)

# Gies: user-supplied design upload (see gies_uploads.py).
from gies_uploads import register_upload_tools
register_upload_tools(app)

# Gies: live HTML preview of the deck being built (see gies_preview.py).
from gies_preview import register_preview_tools
register_preview_tools(app, presentations, get_current_presentation_id)

# Gies: delete/move slides, which upstream lacks (see gies_edit.py).
from gies_edit import register_edit_tools
register_edit_tools(app, presentations, get_current_presentation_id)

register_chart_tools(
    app,
    presentations,
    get_current_presentation_id,
    validate_parameters,
    is_positive,
    is_non_negative,
    is_in_range,
    is_valid_rgb
)


# Gies: removed the inline list_presentations / switch_presentation /
# get_server_info tools — they referenced the old single-user
# current_presentation_id global and add noise to the tool set. Per-user
# "current presentation" is handled inside gies_state.ScopedPresentations.

# ---- Main Function ----
def main(transport: str = "stdio", port: int = 8000):
    if transport == "http":
        import asyncio
        # Set the port for HTTP transport
        app.settings.port = port
        # Start the FastMCP server with HTTP transport
        try:
            app.run(transport='streamable-http')
        except asyncio.exceptions.CancelledError:
            print("Server stopped by user.")
        except KeyboardInterrupt:
            print("Server stopped by user.")
        except Exception as e:
            print(f"Error starting server: {e}")
            
    elif transport == "sse":
        # Run the FastMCP server in SSE (Server Side Events) mode
        app.run(transport='sse')
        
    else:
        # Run the FastMCP server
        app.run(transport='stdio')

if __name__ == "__main__":
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="MCP Server for PowerPoint manipulation using python-pptx")

    parser.add_argument(
        "-t",
        "--transport",
        type=str,
        default="stdio",
        choices=["stdio", "http", "sse"],
        help="Transport method for the MCP server (default: stdio)"
    )

    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8000,
        help="Port to run the MCP server on (default: 8000)"
    )
    args = parser.parse_args()
    main(args.transport, args.port)
